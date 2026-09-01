import { describe, expect, it } from 'vitest'
import {
  normalizeWeeklyResetCodeInput,
  parseWeeklyResetCode,
  weeklyResetCodeValue,
} from './ai-account-reset-code'

describe('AI 계정 주간 초기화 코드', () => {
  it('시간만 입력하면 날짜 미정 코드를 붙인다', () => {
    expect(normalizeWeeklyResetCodeInput('0110')).toBe('01100000')
    expect(normalizeWeeklyResetCodeInput('110')).toBe('01100000')
  })

  it('HHMMMMDD 순서로 날짜와 시간을 해석한다', () => {
    const result = parseWeeklyResetCode('01100911', new Date('2026-09-01T00:00:00+09:00'))
    expect(result.code).toBe('01100911')
    expect(result.resetAt?.toISOString()).toBe('2026-09-10T16:10:00.000Z')
  })

  it('날짜가 0000이면 시간 코드만 저장한다', () => {
    expect(parseWeeklyResetCode('0110').code).toBe('01100000')
    expect(parseWeeklyResetCode('0110').resetAt).toBeNull()
  })

  it('저장된 코드가 있으면 날짜보다 우선 표시한다', () => {
    expect(weeklyResetCodeValue('01100000', null)).toBe('01100000')
  })
})
