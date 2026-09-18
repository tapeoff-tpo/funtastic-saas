'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { buildClearedLoginSessionCookies } from '@/lib/auth/login-session'

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const cookieStore = await cookies()
  for (const cookie of buildClearedLoginSessionCookies(process.env.NODE_ENV === 'production')) {
    cookieStore.set(cookie.name, cookie.value, cookie.options)
  }
  redirect('/login')
}
