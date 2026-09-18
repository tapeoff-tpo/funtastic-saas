import { describe, expect, it } from 'vitest'
import {
  isPasswordChangeRequired,
  withPasswordChangeRequired,
} from './force-password-change'

describe('forced password change metadata', () => {
  it('recognizes only the explicit server-controlled true flag', () => {
    expect(isPasswordChangeRequired({ must_change_password: true })).toBe(true)
    expect(isPasswordChangeRequired({ must_change_password: false })).toBe(false)
    expect(isPasswordChangeRequired({})).toBe(false)
    expect(isPasswordChangeRequired(null)).toBe(false)
  })

  it('preserves unrelated app metadata while updating the flag', () => {
    expect(withPasswordChangeRequired({ role: 'super_admin' }, true)).toEqual({
      role: 'super_admin',
      must_change_password: true,
    })
    expect(withPasswordChangeRequired(null, false)).toEqual({
      must_change_password: false,
    })
  })
})
