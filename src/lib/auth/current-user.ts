import { cache } from 'react'
import { cookies } from 'next/headers'
import { LOCAL_SESSION_COOKIE, validateLocalSession } from './local-session'

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
  return validateLocalSession((await cookies()).get(LOCAL_SESSION_COOKIE)?.value)
})
