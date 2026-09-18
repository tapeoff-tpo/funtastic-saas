import { describe, expect, it } from 'vitest'
import {
  LOGIN_SESSION_MODE_COOKIE,
  LOGIN_SESSION_PROOF_COOKIE,
  ONE_WEEK_SECONDS,
  buildClearedLoginSessionCookies,
  buildLoginSessionCookies,
  hasExpiredManagedLoginSession,
} from './login-session'

describe('login session policy', () => {
  it('keeps a checked login valid for one week', () => {
    const cookies = buildLoginSessionCookies({ rememberForOneWeek: true, secure: true })

    expect(cookies).toEqual([
      expect.objectContaining({ name: LOGIN_SESSION_MODE_COOKIE, value: 'week' }),
      expect.objectContaining({
        name: LOGIN_SESSION_PROOF_COOKIE,
        value: '1',
        options: expect.objectContaining({ maxAge: ONE_WEEK_SECONDS, secure: true }),
      }),
    ])
  })

  it('uses a browser-session proof when login persistence is not checked', () => {
    const cookies = buildLoginSessionCookies({ rememberForOneWeek: false, secure: false })

    expect(cookies[0]).toMatchObject({
      name: LOGIN_SESSION_MODE_COOKIE,
      value: 'session',
      options: { maxAge: 400 * 24 * 60 * 60 },
    })
    expect(cookies[1]).toMatchObject({
      name: LOGIN_SESSION_PROOF_COOKIE,
      value: '1',
      options: { secure: false },
    })
    expect(cookies[1].options.maxAge).toBeUndefined()
  })

  it('only treats managed sessions with a missing proof as expired', () => {
    expect(hasExpiredManagedLoginSession('week', undefined)).toBe(true)
    expect(hasExpiredManagedLoginSession('session', undefined)).toBe(true)
    expect(hasExpiredManagedLoginSession('week', '1')).toBe(false)
    expect(hasExpiredManagedLoginSession(undefined, undefined)).toBe(false)
  })

  it('clears both session policy cookies on sign-out', () => {
    const cookies = buildClearedLoginSessionCookies(true)
    expect(cookies).toHaveLength(2)
    expect(cookies.every((cookie) => cookie.options.maxAge === 0)).toBe(true)
  })
})
