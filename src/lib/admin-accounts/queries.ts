/**
 * Admin account queries (read-only).
 * Uses service-role admin client to read user_profiles directly,
 * bypassing RLS for server-side use.
 */
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { marketplaceConnections, orders, products, userProfiles, auditLogs, type UserProfile } from '@/lib/db/schema'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'

export const deletedAccountLog = sql`${auditLogs.action} = 'account.deactivate' AND ${auditLogs.metadata}->>'deleted' = 'true'`

export async function listAdmins(): Promise<UserProfile[]> {
  return db
    .select()
    .from(userProfiles)
    .where(sql`NOT EXISTS (
      SELECT 1 FROM ${auditLogs}
      WHERE ${auditLogs.targetId} = ${userProfiles.id} AND ${deletedAccountLog}
    )`)
    .orderBy(desc(userProfiles.createdAt))
}

/**
 * Returns the user_profiles row for the given userId.
 * Wrapped in React.cache() so layout + page calls within the same request
 * only execute the DB query once (per-request memoization).
 */
export const getProfile = cache(async (userId: string): Promise<UserProfile | null> => {
  const [row] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.id, userId))
    .limit(1)
  return row ?? null
})

/**
 * Operational data is shared by staff accounts in this single-company workspace.
 * Super admins own the marketplace connections/orders; regular admin accounts read/write
 * through that owner id so staff see the same synced orders after logging in.
 */
const getSharedOperationalOwner = unstable_cache(async (): Promise<string | null> => {
  // COALESCE evaluates only until an owner is found. A renamed canonical
  // account must not cause unused order/product scans on every cold request.
  const [owner] = await db.execute<{ id: string | null }>(sql`
    SELECT COALESCE(
      (SELECT ${userProfiles.id} FROM ${userProfiles}
        WHERE ${userProfiles.deactivatedAt} IS NULL AND (${userProfiles.email} ILIKE ${'admin123%'} OR ${userProfiles.displayName} ILIKE ${'admin123%'})
        ORDER BY ${userProfiles.createdAt} ASC LIMIT 1),
      (SELECT ${marketplaceConnections.userId} FROM ${marketplaceConnections} ORDER BY ${marketplaceConnections.createdAt} ASC LIMIT 1),
      (SELECT ${orders.userId} FROM ${orders} ORDER BY ${orders.createdAt} ASC LIMIT 1),
      (SELECT ${products.userId} FROM ${products} ORDER BY ${products.createdAt} ASC LIMIT 1)
    ) AS id
  `)
  return owner?.id ?? null
}, ['shared-operational-workspace-owner-v1'], { revalidate: 60 })

async function resolveWorkspaceUserId(userId: string): Promise<string> {
  const operationalOwner = await getSharedOperationalOwner()
  if (operationalOwner) return operationalOwner

  const profile = await getProfile(userId)
  if (profile?.createdBy) return profile.createdBy

  if (profile?.role === 'super_admin') return userId

  const [owner] = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(and(eq(userProfiles.role, 'super_admin'), isNull(userProfiles.deactivatedAt)))
    .orderBy(asc(userProfiles.createdAt))
    .limit(1)

  return owner?.id ?? userId
}

// Only the shared ownership decision is cached across accounts. Permissions
// and operational stock/order data retain their existing freshness checks.
export const getWorkspaceUserId = cache(resolveWorkspaceUserId)

export async function getProfileByEmail(email: string): Promise<UserProfile | null> {
  const [row] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.email, email))
    .limit(1)
  return row ?? null
}

export async function listAuditLogs(targetId?: string) {
  const q = db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200)
  if (targetId) {
    return q.where(eq(auditLogs.targetId, targetId))
  }
  return q
}
