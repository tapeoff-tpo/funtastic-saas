'use server'

import { createClient } from '@/lib/supabase/server'
import { isPasswordChangeRequired } from '@/lib/auth/force-password-change'
import { buildLoginSessionCookies } from '@/lib/auth/login-session'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: '이메일과 비밀번호를 입력해주세요.' }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
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
