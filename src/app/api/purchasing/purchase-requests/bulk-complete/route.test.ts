import { describe, expect, it } from 'vitest'
import { purchaseRequestBulkCompleteBodySchema } from './route'

const itemId = '11111111-1111-4111-8111-111111111111'

describe('purchase request bulk complete validation', () => {
  it('accepts one or more outstanding item ids', () => {
    expect(purchaseRequestBulkCompleteBodySchema.safeParse({ ids: [itemId] }).success).toBe(true)
  })

  it('rejects invalid and unrelated input', () => {
    expect(purchaseRequestBulkCompleteBodySchema.safeParse({ ids: [] }).success).toBe(false)
    expect(purchaseRequestBulkCompleteBodySchema.safeParse({ ids: ['not-an-id'] }).success).toBe(false)
    expect(purchaseRequestBulkCompleteBodySchema.safeParse({ ids: [itemId], status: 'completed' }).success).toBe(false)
  })
})
