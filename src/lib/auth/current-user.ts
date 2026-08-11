import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export type CurrentUser = {
  id: string
}

/**
 * Validates the access token without fetching the full user record on every
 * server render. The profile query remains the source of truth for app-level
 * access such as deactivation and role checks.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  return typeof data?.claims?.sub === 'string' ? { id: data.claims.sub } : null
})
