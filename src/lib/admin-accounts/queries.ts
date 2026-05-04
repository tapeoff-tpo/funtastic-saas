/**
 * Admin account queries (read-only).
 * Uses service-role admin client to read user_profiles directly,
 * bypassing RLS for server-side use.
 */
import { cache } from 'react'
import { db } from '@/lib/db'
import { marketplaceConnections, orders, userProfiles, auditLogs, type UserProfile } from '@/lib/db/schema'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'

export async function listAdmins(): Promise<UserProfile[]> {
  return db
    .select()
    .from(userProfiles)
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
export const getWorkspaceUserId = cache(async (userId: string): Promise<string> => {
  const profile = await getProfile(userId)
  if (profile?.createdBy) return profile.createdBy

  const [connectionOwner] = await db
    .select({ id: marketplaceConnections.userId })
    .from(marketplaceConnections)
    .orderBy(asc(marketplaceConnections.createdAt))
    .limit(1)
  if (connectionOwner?.id) return connectionOwner.id

  const [orderOwner] = await db
    .select({ id: orders.userId })
    .from(orders)
    .orderBy(asc(orders.createdAt))
    .limit(1)
  if (orderOwner?.id) return orderOwner.id

  if (profile?.role === 'super_admin') return userId

  const [owner] = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(and(eq(userProfiles.role, 'super_admin'), isNull(userProfiles.deactivatedAt)))
    .orderBy(asc(userProfiles.createdAt))
    .limit(1)

  return owner?.id ?? userId
})

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
