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
import {
  isPasswordChangeRequired,
  withPasswordChangeRequired,
} from '@/lib/auth/force-password-change'
import { db } from '@/lib/db'
import { userProfiles, auditLogs, type UserRole } from '@/lib/db/schema'
import { eq, and, isNull, sql, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'

const BAN_FOREVER = '876000h' // ~100 years (Supabase ban_duration is a Go duration string)
const RESET_PASSWORD = '0000'

type ActionResult<T = void> = { success: true; data?: T } | { success: false; error: string }

function getInitialPassword(): string {
  const pw = process.env.INITIAL_USER_PASSWORD
  if (!pw) throw new Error('INITIAL_USER_PASSWORD env var not set')
  return pw
}

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? ''
}

function getResetPasswordErrorMessage(errorMessage: string): string {
  const normalized = errorMessage.toLowerCase()
  if (
    normalized.includes('password')
    && (normalized.includes('at least') || normalized.includes('minimum') || normalized.includes('length'))
  ) {
    return '인증 서버의 최소 비밀번호 길이 설정 때문에 0000으로 초기화하지 못했습니다.'
  }
  return errorMessage
}

/**
 * Legacy profile rows can predate their matching Supabase auth user. Resolve
 * by ID first, then fall back to the profile email so a reset always targets
 * the identity that actually signs in.
 */
async function resolveAuthUserForProfile(
  admin: ReturnType<typeof createAdminClient>,
  profile: { id: string; email: string },
) {
  const profileEmail = normalizeEmail(profile.email)
  const { data: directLookup } = await admin.auth.admin.getUserById(profile.id)
  if (directLookup.user && normalizeEmail(directLookup.user.email) === profileEmail) {
    return {
      ok: true as const,
      userId: directLookup.user.id,
      appMetadata: directLookup.user.app_metadata,
    }
  }

  const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (listError) return { ok: false as const, error: listError.message }

  const matchedUser = listedUsers.users.find(
    (user) => normalizeEmail(user.email) === profileEmail,
  )
  if (!matchedUser) {
    return { ok: false as const, error: `Auth user not found for ${profile.email}` }
  }

  return {
    ok: true as const,
    userId: matchedUser.id,
    appMetadata: matchedUser.app_metadata,
  }
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
      const { data: authTarget, error: authTargetError } = await admin.auth.admin.getUserById(target.id)
      if (authTargetError || !authTarget.user) {
        throw new Error(authTargetError?.message ?? 'Auth user not found')
      }
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(target.id, {
        app_metadata: {
          ...authTarget.user.app_metadata,
          role: input.newRole,
        },
      })
      if (authUpdateError) throw new Error(authUpdateError.message)

      return { success: true as const }
    })
    .then(() => {
      revalidatePath('/admin/accounts')
      return { success: true } as ActionResult
    })
    .catch((e) => ({ success: false, error: e instanceof Error ? e.message : 'Role change failed' }))
}

/** Reset a user's password and require a new password on their next login. */
export async function resetAccountPassword(input: { targetId: string }): Promise<ActionResult> {
  const guard = await assertSuperAdmin()
  if (!guard.ok) return { success: false, error: guard.error }

  const [target] = await db
    .select({ id: userProfiles.id, email: userProfiles.email })
    .from(userProfiles)
    .where(eq(userProfiles.id, input.targetId))
    .limit(1)
  if (!target) return { success: false, error: 'Target not found' }

  const admin = createAdminClient()
  const authTarget = await resolveAuthUserForProfile(admin, target)
  if (!authTarget.ok) {
    return { success: false, error: authTarget.error }
  }

  const { data: updatedAuthUser, error } = await admin.auth.admin.updateUserById(authTarget.userId, {
    // Supabase's normal password policy can reject a four-character reset
    // password. The server-only admin API accepts a bcrypt hash instead;
    // the forced-change flag makes this temporary password unusable beyond
    // the first sign-in screen.
    password_hash: await bcrypt.hash(RESET_PASSWORD, 12),
    app_metadata: withPasswordChangeRequired(authTarget.appMetadata, true),
  })
  if (error) return { success: false, error: getResetPasswordErrorMessage(error.message) }
  if (normalizeEmail(updatedAuthUser.user?.email) !== normalizeEmail(target.email)) {
    return { success: false, error: '비밀번호 초기화 대상 계정을 확인하지 못했습니다.' }
  }

  await db.transaction(async (tx) => {
    await tx.insert(auditLogs).values({
      actorId: guard.callerId,
      action: 'account.password_reset',
      targetId: input.targetId,
      metadata: {
        forcePasswordChange: true,
        authUserId: authTarget.userId,
        resolvedByEmail: authTarget.userId !== target.id,
      },
    })
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
}): Promise<ActionResult<{ requiresFreshLogin: boolean }>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  const userId = user.id
  const requiresFreshLogin = isPasswordChangeRequired(user.app_metadata)

  if (!input.newPassword || input.newPassword.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters' }
  }

  const { error } = await supabase.auth.updateUser({ password: input.newPassword })
  if (error) return { success: false, error: error.message }

  const admin = createAdminClient()
  const { error: forceFlagError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: withPasswordChangeRequired(user.app_metadata, false),
  })
  if (forceFlagError) {
    return { success: false, error: `비밀번호는 변경됐지만 강제변경 상태 해제에 실패했습니다: ${forceFlagError.message}` }
  }

  await db.transaction(async (tx) => {
    await tx.insert(auditLogs).values({
      actorId: userId,
      action: 'password.self_change',
      targetId: userId,
    })
  })

  revalidatePath('/change-password')
  revalidatePath('/dashboard')
  if (requiresFreshLogin) await supabase.auth.signOut()

  return { success: true, data: { requiresFreshLogin } }
}
