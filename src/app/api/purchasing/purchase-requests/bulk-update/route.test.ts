import { describe, expect, it } from 'vitest'
import { purchaseRequestBulkUpdateBodySchema } from './route'

const itemId = '11111111-1111-4111-8111-111111111111'

describe('purchase request bulk update validation', () => {
  it('accepts the existing buyer update body', () => {
    expect(purchaseRequestBulkUpdateBodySchema.safeParse({
      ids: [itemId],
      buyerCode: '4',
    }).success).toBe(true)
  })

  it('accepts marking or unmarking selected rows as bulk-payment pending', () => {
    expect(purchaseRequestBulkUpdateBodySchema.safeParse({
      ids: [itemId],
      bulkPaymentPending: true,
      bulkPaymentDueDate: '2026-09-30',
    }).success).toBe(true)
    expect(purchaseRequestBulkUpdateBodySchema.safeParse({
      ids: [itemId],
      bulkPaymentPending: false,
      bulkPaymentDueDate: null,
    }).success).toBe(true)
  })

  it('rejects invalid or unrelated updates', () => {
    expect(purchaseRequestBulkUpdateBodySchema.safeParse({
      ids: [itemId],
      bulkPaymentDueDate: '2026-09-30',
    }).success).toBe(false)
    expect(purchaseRequestBulkUpdateBodySchema.safeParse({
      ids: [itemId],
      bulkPaymentPending: false,
      bulkPaymentDueDate: '2026-09-30',
    }).success).toBe(false)
    expect(purchaseRequestBulkUpdateBodySchema.safeParse({
      ids: [itemId],
      bulkPaymentPending: true,
      bulkPaymentDueDate: '2026-02-30',
    }).success).toBe(false)
    expect(purchaseRequestBulkUpdateBodySchema.safeParse({
      ids: [itemId],
      bulkPaymentPending: true,
      unexpected: true,
    }).success).toBe(false)
  })
})
