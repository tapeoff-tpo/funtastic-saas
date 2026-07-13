import { describe, expect, it } from 'vitest'
import {
  extractVerificationCode,
  hashSmsBridgeToken,
  isPicklePlusMessage,
} from './sms-bridge-utils'

describe('sms bridge message filtering', () => {
  it('accepts only PicklePlus messages', () => {
    expect(isPicklePlusMessage('피클플러스', '인증번호 123456')).toBe(true)
    expect(isPicklePlusMessage('15880000', '[Pickle Plus] code 123456')).toBe(true)
    expect(isPicklePlusMessage('택배', '배송이 시작되었습니다.')).toBe(false)
  })

  it('extracts a contextual verification code first', () => {
    expect(extractVerificationCode('[피클플러스] 인증번호는 384921 입니다.')).toBe('384921')
    expect(extractVerificationCode('문의 02-1234-5678 / OTP 9301')).toBe('9301')
    expect(extractVerificationCode('코드가 없는 안내문입니다.')).toBeNull()
  })

  it('hashes tokens deterministically without retaining the source token', () => {
    const hash = hashSmsBridgeToken('one-time-secret')
    expect(hash).toHaveLength(64)
    expect(hash).toBe(hashSmsBridgeToken('one-time-secret'))
    expect(hash).not.toContain('one-time-secret')
  })
})
