import { describe, expect, it } from 'vitest'
import {
  RESET_PASSWORD,
  getTemporaryResetAuthPassword,
} from './temporary-reset-password'

describe('temporary reset password', () => {
  it('keeps the user-facing reset password at 0000 while deriving a stronger auth password', () => {
    const authPassword = getTemporaryResetAuthPassword('user-a', 'test-service-role-secret')

    expect(RESET_PASSWORD).toBe('0000')
    expect(authPassword.length).toBeGreaterThanOrEqual(8)
    expect(authPassword).not.toBe(RESET_PASSWORD)
  })

  it('is stable per account and different between accounts', () => {
    const secret = 'test-service-role-secret'
    const first = getTemporaryResetAuthPassword('user-a', secret)

    expect(getTemporaryResetAuthPassword('user-a', secret)).toBe(first)
    expect(getTemporaryResetAuthPassword('user-b', secret)).not.toBe(first)
  })
})
