'use server'

/**
 * Admin account management server actions.
 *
 * All super_admin-only actions verify the caller's role before executing.
 * Sensitive operations (createUser, updatePassword, ban) use the service-role admin client.
 *
 * Last super_admin protection: cannot demote/deactivate the only active super_admin.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { db } from '@/lib/db'
import { userProfiles, auditLogs, type UserRole } from '@/lib/db/schema'
import { eq, and, isNull, sql, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

const BAN_FOREVER = '876000h' // ~100 years (Supabase ban_duration is a Go duration string)

type ActionResult<T = void> = { success: true; data?: T } | { success: false; error: string }

function getInitialPassword(): string {
  const pw = process.env.INITIAL_USER_PASSWORD
  if (!pw) throw new Error('INITIAL_USER_PASSWORD env var not set')
  return pw
}

/**
 * Resolve the currently authenticated caller and assert super_admin role.
 * Returns the caller's profile ID on success.
 */
async function assertSuperAdmin(): Promise<{ ok: true; callerId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const [profile] = await db
    .select({ role: userProfiles.role, deactivatedAt: userProfiles.deactivatedAt })
    .from(userProfiles)
    .where(eq(userProfiles.id, user.id))
    .limit(1)

  if (!profile) return { ok: false, error: 'No profile found' }
  if (profile.deactivatedAt) return { ok: false, error: 'Account deactivated' }
  if (profile.role !== 'super_admin') return { ok: false, error: 'Forbidden: super_admin only' }

  return { ok: true, callerId: user.id }
}

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

/**
 * Create a new admin account.
 * Initial password from INITIAL_USER_PASSWORD env var.
 */
export async function createAccount(input: {
  email: string
  role: UserRole
  displayName?: string
}): Promise<ActionResult<{ id: string }>> {
  const guard = await assertSuperAdmin()
  if (!guard.ok) return { success: false, error: guard.error }

  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return { success: false, error: 'Invalid email' }
  }

  const admin = createAdminClient()
  const password = getInitialPassword()

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: input.role },
    user_metadata: { display_name: input.displayName ?? null },
  })
  if (error || !data.user) {
    return { success: false, error: error?.message ?? 'Failed to create user' }
  }

  const newId = data.user.id

  try {
    await db.transaction(async (tx) => {
      await tx.insert(userProfiles).values({
        id: newId,
        email,
        role: input.role,
        displayName: input.displayName ?? null,
        createdBy: guard.callerId,
      })
      await tx.insert(auditLogs).values({
        actorId: guard.callerId,
        action: 'account.create',
        targetId: newId,
        metadata: { email, role: input.role, displayName: input.displayName ?? null },
      })
    })
  } catch (e) {
    // Compensating: delete the auth.user we just created
    await admin.auth.admin.deleteUser(newId).catch(() => {})
    return { success: false, error: e instanceof Error ? e.message : 'DB insert failed' }
  }

  revalidatePath('/admin/accounts')
  return { success: true, data: { id: newId } }
}

/**
 * Change a user's role.
 */
export async function changeRole(input: {
  targetId: string
  newRole: UserRole
}): Promise<ActionResult> {
  const guard = await assertSuperAdmin()
  if (!guard.ok) return { success: false, error: guard.error }

  return db
    .transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.id, input.targetId))
        .for('update')

      if (!target) throw new Error('Target not found')
      if (target.role === input.newRole) {
        return { success: true as const }
      }

      // Last super_admin protection: if we're demoting the last active super_admin, refuse.
      if (target.role === 'super_admin' && input.newRole !== 'super_admin') {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(userProfiles)
          .where(
            and(
              eq(userProfiles.role, 'super_admin'),
              isNull(userProfiles.deactivatedAt),
              ne(userProfiles.id, target.id),
            ),
          )
        if (count === 0) {
          throw new Error('Cannot demote the last active super_admin')
        }
      }

      await tx
        .update(userProfiles)
        .set({ role: input.newRole })
        .where(eq(userProfiles.id, target.id))

      await tx.insert(auditLogs).values({
        actorId: guard.callerId,
        action: 'account.role_change',
        targetId: target.id,
        metadata: { from: target.role, to: input.newRole, email: target.email },
      })

      // Mirror role into auth.users.app_metadata for JWT consistency
      const admin = createAdminClient()
      await admin.auth.admin.updateUserById(target.id, {
        app_metadata: { role: input.newRole },
      })

      return { success: true as const }
    })
    .then(() => {
      revalidatePath('/admin/accounts')
      return { success: true } as ActionResult
    })
    .catch((e) => ({ success: false, error: e instanceof Error ? e.message : 'Role change failed' }))
}

/**
 * Reset a user's password to INITIAL_USER_PASSWORD.
 */
export async function resetAccountPassword(input: { targetId: string }): Promise<ActionResult> {
  const guard = await assertSuperAdmin()
  if (!guard.ok) return { success: false, error: guard.error }

  const admin = createAdminClient()
  const password = getInitialPassword()

  const { error } = await admin.auth.admin.updateUserById(input.targetId, { password })
  if (error) return { success: false, error: error.message }

  await db.insert(auditLogs).values({
    actorId: guard.callerId,
    action: 'account.password_reset',
    targetId: input.targetId,
  })

  revalidatePath('/admin/accounts')
  return { success: true }
}

/**
 * Deactivate (soft delete + ban login) a user.
 */
export async function deactivateAccount(input: { targetId: string }): Promise<ActionResult> {
  const guard = await assertSuperAdmin()
  if (!guard.ok) return { success: false, error: guard.error }

  if (input.targetId === guard.callerId) {
    return { success: false, error: 'Cannot deactivate yourself' }
  }

  return db
    .transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.id, input.targetId))
        .for('update')

      if (!target) throw new Error('Target not found')
      if (target.deactivatedAt) {
        return { success: true as const } // already deactivated, idempotent
      }

      // Last super_admin protection
      if (target.role === 'super_admin') {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(userProfiles)
          .where(
            and(
              eq(userProfiles.role, 'super_admin'),
              isNull(userProfiles.deactivatedAt),
              ne(userProfiles.id, target.id),
            ),
          )
        if (count === 0) {
          throw new Error('Cannot deactivate the last active super_admin')
        }
      }

      await tx
        .update(userProfiles)
        .set({ deactivatedAt: new Date(), deactivatedBy: guard.callerId })
        .where(eq(userProfiles.id, target.id))

      await tx.insert(auditLogs).values({
        actorId: guard.callerId,
        action: 'account.deactivate',
        targetId: target.id,
        metadata: { email: target.email },
      })

      const admin = createAdminClient()
      await admin.auth.admin.updateUserById(target.id, { ban_duration: BAN_FOREVER })

      return { success: true as const }
    })
    .then(() => {
      revalidatePath('/admin/accounts')
      return { success: true } as ActionResult
    })
    .catch((e) => ({ success: false, error: e instanceof Error ? e.message : 'Deactivation failed' }))
}

/**
 * Reactivate a deactivated user.
 */
export async function reactivateAccount(input: { targetId: string }): Promise<ActionResult> {
  const guard = await assertSuperAdmin()
  if (!guard.ok) return { success: false, error: guard.error }

  await db.transaction(async (tx) => {
    await tx
      .update(userProfiles)
      .set({ deactivatedAt: null, deactivatedBy: null })
      .where(eq(userProfiles.id, input.targetId))

    await tx.insert(auditLogs).values({
      actorId: guard.callerId,
      action: 'account.reactivate',
      targetId: input.targetId,
    })

    const admin = createAdminClient()
    await admin.auth.admin.updateUserById(input.targetId, { ban_duration: 'none' })
  })

  revalidatePath('/admin/accounts')
  return { success: true }
}

/**
 * Self-service password change. Any authenticated user.
 */
export async function changeOwnPassword(input: {
  newPassword: string
}): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  if (!userId) return { success: false, error: 'Not authenticated' }

  if (!input.newPassword || input.newPassword.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: input.newPassword })
  if (error) return { success: false, error: error.message }

  await db.insert(auditLogs).values({
    actorId: userId,
    action: 'password.self_change',
    targetId: userId,
  })

  return { success: true }
}
