export const LOGIN_SESSION_MODE_COOKIE = 'funtastic-login-session-mode'
export const LOGIN_SESSION_PROOF_COOKIE = 'funtastic-login-session-proof'
export const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60
const MODE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60

type SessionCookieOptions = {
  httpOnly: boolean
  sameSite: 'lax'
  secure: boolean
  path: '/'
  maxAge?: number
}

export type LoginSessionCookie = {
  name: string
  value: string
  options: SessionCookieOptions
}

/**
 * The mode marker outlives the actual session-proof cookie. That lets the
 * proxy distinguish an expired seven-day/session-only login from a legacy
 * session created before this policy was added.
 */
export function buildLoginSessionCookies(input: {
  rememberForOneWeek: boolean
  secure: boolean
}): LoginSessionCookie[] {
  const base: SessionCookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: input.secure,
    path: '/',
  }

  return [
    {
      name: LOGIN_SESSION_MODE_COOKIE,
      value: input.rememberForOneWeek ? 'week' : 'session',
      options: { ...base, maxAge: MODE_COOKIE_MAX_AGE_SECONDS },
    },
    {
      name: LOGIN_SESSION_PROOF_COOKIE,
      value: '1',
      options: input.rememberForOneWeek
        ? { ...base, maxAge: ONE_WEEK_SECONDS }
        : base,
    },
  ]
}

export function buildClearedLoginSessionCookies(secure: boolean): LoginSessionCookie[] {
  const options: SessionCookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  }

  return [
    { name: LOGIN_SESSION_MODE_COOKIE, value: '', options },
    { name: LOGIN_SESSION_PROOF_COOKIE, value: '', options },
  ]
}

export function hasExpiredManagedLoginSession(
  mode: string | undefined,
  proof: string | undefined,
): boolean {
  return (mode === 'week' || mode === 'session') && proof !== '1'
}
