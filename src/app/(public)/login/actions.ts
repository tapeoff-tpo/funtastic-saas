'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPasswordChangeRequired } from '@/lib/auth/force-password-change'
import { buildLoginSessionCookies } from '@/lib/auth/login-session'
import {
  RESET_PASSWORD,
  getTemporaryResetAuthPassword,
} from '@/lib/auth/temporary-reset-password'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { compare } from 'bcryptjs'
import { createHash } from 'node:crypto'
import { authDatabase, createLocalSession, LOCAL_SESSION_COOKIE } from '@/lib/auth/local-session'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Keep the reset password experience at `0000` without weakening the
 * authentication provider's password policy for every account.
 */
async function getPasswordForSignIn(email: string, password: string): Promise<string> {
  if (password !== RESET_PASSWORD) return password

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error) return password

    const user = data.users.find(
      (candidate) => normalizeEmail(candidate.email ?? '') === normalizeEmail(email),
    )
    if (!user || !isPasswordChangeRequired(user.app_metadata)) return password

    return getTemporaryResetAuthPassword(user.id)
  } catch {
    // Preserve Supabase's normal generic invalid-credentials response rather
    // than leaking whether an account is currently in the reset state.
    return password
  }
}

export async function login(formData: FormData) {
  if (process.env.AUTH_PROVIDER === 'local') {
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')
    const sql = authDatabase()
    const [limit] = await sql`INSERT INTO app_auth_login_limits(email_hash) VALUES(${createHash('sha256').update(email).digest('hex')}) ON CONFLICT(email_hash) DO UPDATE SET attempts = CASE WHEN app_auth_login_limits.window_start < now() - interval '15 minutes' THEN 1 ELSE app_auth_login_limits.attempts + 1 END, window_start = CASE WHEN app_auth_login_limits.window_start < now() - interval '15 minutes' THEN now() ELSE app_auth_login_limits.window_start END RETURNING attempts`
    if (Number(limit.attempts) > 10) return { error: '로그인 시도가 많습니다. 15분 후 다시 시도해주세요.' }
    const [account] = await sql`SELECT user_id::text, password_hash FROM app_auth_accounts WHERE lower(email) = ${email} AND approval_status = 'approved'`
    if (!account?.password_hash || !await compare(password, String(account.password_hash))) return { error: '로그인 정보가 올바르지 않거나 비밀번호 설정·승인이 필요합니다.' }
    const { token, expiresAt } = await createLocalSession(String(account.user_id))
    ;(await cookies()).set(LOCAL_SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: expiresAt })
    redirect('/dashboard')
  }
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: '이메일과 비밀번호를 입력해주세요.' }
  }

  const passwordForSignIn = await getPasswordForSignIn(email, password)
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: passwordForSignIn,
  })

  if (error) {
    return { error: error.message }
  }

  const rememberForOneWeek = formData.get('rememberForOneWeek') === 'on'
  const cookieStore = await cookies()
  for (const cookie of buildLoginSessionCookies({
    rememberForOneWeek,
    secure: process.env.NODE_ENV === 'production',
  })) {
    cookieStore.set(cookie.name, cookie.value, cookie.options)
  }

  if (isPasswordChangeRequired(data.user?.app_metadata)) redirect('/change-password')

  redirect('/dashboard')
}
