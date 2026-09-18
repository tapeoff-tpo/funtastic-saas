import { describe, expect, it } from 'vitest'
import { purchaseRequestBulkPaymentCompleteBodySchema } from './route'

const itemId = '11111111-1111-4111-8111-111111111111'

describe('bulk payment completion request validation', () => {
  it('accepts one or more purchase request ids', () => {
    expect(purchaseRequestBulkPaymentCompleteBodySchema.safeParse({ ids: [itemId] }).success).toBe(true)
  })

  it('rejects empty, invalid, excessive, and unrelated input', () => {
    expect(purchaseRequestBulkPaymentCompleteBodySchema.safeParse({ ids: [] }).success).toBe(false)
    expect(purchaseRequestBulkPaymentCompleteBodySchema.safeParse({ ids: ['not-an-id'] }).success).toBe(false)
    expect(purchaseRequestBulkPaymentCompleteBodySchema.safeParse({ ids: Array(201).fill(itemId) }).success).toBe(false)
    expect(purchaseRequestBulkPaymentCompleteBodySchema.safeParse({ ids: [itemId], status: 'completed' }).success).toBe(false)
  })
})
