import { describe, expect, it } from 'vitest'
import { purchaseRequestBulkDeleteBodySchema } from './route'

const itemId = '11111111-1111-4111-8111-111111111111'

describe('purchase request bulk delete validation', () => {
  it('accepts one or more purchase request ids', () => {
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: [itemId] }).success).toBe(true)
  })

  it('rejects empty, invalid, excessive, and unrelated input', () => {
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: [] }).success).toBe(false)
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: ['not-an-id'] }).success).toBe(false)
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: Array(201).fill(itemId) }).success).toBe(false)
    expect(purchaseRequestBulkDeleteBodySchema.safeParse({ ids: [itemId], userId: itemId }).success).toBe(false)
  })
})
