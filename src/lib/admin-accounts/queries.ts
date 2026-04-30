/**
 * Admin account queries (read-only).
 * Uses service-role admin client to read user_profiles directly,
 * bypassing RLS for server-side use.
 */
import { cache } from 'react'
import { db } from '@/lib/db'
import { userProfiles, auditLogs, type UserProfile } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

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
