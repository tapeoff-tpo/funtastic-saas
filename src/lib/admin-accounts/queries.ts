/**
 * Admin account queries (read-only).
 * Uses service-role admin client to read user_profiles directly,
 * bypassing RLS for server-side use.
 */
import { cache } from 'react'
import { db } from '@/lib/db'
import { marketplaceConnections, orders, products, userProfiles, auditLogs, type UserProfile } from '@/lib/db/schema'
import { and, asc, desc, eq, ilike, isNull, or } from 'drizzle-orm'

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

  // Keep the existing owner precedence, but avoid serial database round trips
  // on every server-rendered page.
  const [admin123Rows, connectionRows, orderRows, productRows] = await Promise.all([
    db
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(and(
        isNull(userProfiles.deactivatedAt),
        or(
          ilike(userProfiles.email, 'admin123%'),
          ilike(userProfiles.displayName, 'admin123%'),
        ),
      ))
      .orderBy(asc(userProfiles.createdAt))
      .limit(1),
    db
      .select({ id: marketplaceConnections.userId })
      .from(marketplaceConnections)
      .orderBy(asc(marketplaceConnections.createdAt))
      .limit(1),
    db
      .select({ id: orders.userId })
      .from(orders)
      .orderBy(asc(orders.createdAt))
      .limit(1),
    db
      .select({ id: products.userId })
      .from(products)
      .orderBy(asc(products.createdAt))
      .limit(1),
  ])

  const admin123Owner = admin123Rows[0]
  const connectionOwner = connectionRows[0]
  const orderOwner = orderRows[0]
  const productOwner = productRows[0]

  if (admin123Owner?.id) return admin123Owner.id
  if (connectionOwner?.id) return connectionOwner.id
  if (orderOwner?.id) return orderOwner.id
  if (productOwner?.id) return productOwner.id

  if (profile?.createdBy) return profile.createdBy

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
