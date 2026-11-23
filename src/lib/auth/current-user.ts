import { cache } from 'react'
import { cookies } from 'next/headers'
import { LOCAL_SESSION_COOKIE, validateLocalSession, type SessionAuthorization } from './local-session'

export type CurrentUser = {
  id: string
  mustChangePassword: boolean
  /** Fresh database permissions from this request's session validation. */
  authorization?: SessionAuthorization
}

/**
 * Validates the local session and loads current profile/menu access together.
 * Request memoization avoids repeating this database query within a render;
 * no account access state is cached between requests.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  return validateLocalSession((await cookies()).get(LOCAL_SESSION_COOKIE)?.value)
})
