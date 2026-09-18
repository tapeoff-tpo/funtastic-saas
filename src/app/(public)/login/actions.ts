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
