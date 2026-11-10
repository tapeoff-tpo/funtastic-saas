import { cache } from 'react'
import { cookies } from 'next/headers'
import { LOCAL_SESSION_COOKIE, validateLocalSession } from './local-session'
import { createClient } from '@/lib/supabase/server'
import { isPasswordChangeRequired } from '@/lib/auth/force-password-change'

export type CurrentUser = {
  id: string
  mustChangePassword: boolean
}

/**
 * Validates the access token without fetching the full user record on every
 * server render. The profile query remains the source of truth for app-level
 * access such as deactivation and role checks.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (process.env.AUTH_PROVIDER === 'local') return validateLocalSession((await cookies()).get(LOCAL_SESSION_COOKIE)?.value)
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (typeof data?.claims?.sub !== 'string') return null

  return {
    id: data.claims.sub,
    mustChangePassword: isPasswordChangeRequired(data.claims.app_metadata),
  }
})
