import { describe, expect, it } from 'vitest'
import { bulkPaymentDepositBodySchema } from './route'

describe('bulk payment deposit request validation', () => {
  it('accepts a cumulative CNY deposit with its payment date and memo', () => {
    expect(bulkPaymentDepositBodySchema.safeParse({
      depositCny: 350.5,
      depositPaidAt: '2026-09-15',
      depositMemo: '30% 선금 지급',
    }).success).toBe(true)
  })

  it('allows clearing an existing deposit', () => {
    expect(bulkPaymentDepositBodySchema.safeParse({
      depositCny: 0,
      depositPaidAt: null,
      depositMemo: null,
    }).success).toBe(true)
  })

  it('rejects malformed payment dates and unexpected fields', () => {
    expect(bulkPaymentDepositBodySchema.safeParse({
      depositCny: 10,
      depositPaidAt: '2026-02-30',
      depositMemo: null,
    }).success).toBe(false)
    expect(bulkPaymentDepositBodySchema.safeParse({
      depositCny: 10,
      depositPaidAt: null,
      depositMemo: null,
      unexpected: true,
    }).success).toBe(false)
  })
})
