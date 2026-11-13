import { describe, expect, it } from 'vitest'
import { buildRequestedFundCharges, requestedChargeOpeningBoundary } from './purchase-fund-requested'
import type { PurchaseFundDebitSourceRow } from './purchase-fund-ledger'

function row(overrides: Partial<PurchaseFundDebitSourceRow> = {}): PurchaseFundDebitSourceRow {
  return { id: 'r1', status: 'purchased', requestDate: '2026-11-03', outboundExpectedDate: null, createdAt: new Date('2026-11-03T00:00:00Z'), sku: 'SKU1', productName: '상품', optionName: null, requestedQuantity: 10, actualPurchaseQuantity: null, purchaseManagementCode: 'BUY1', supplierOrderNumber: null, costExchangeRateKrw: null, specialPriceCny: '10', newCostCny: null, rawData: {}, ...overrides }
}

describe('requested purchase charges', () => {
  it('includes a purchase request without a supplier order number', () => {
    expect(buildRequestedFundCharges([row()], [], 200)).toMatchObject([{ id: 'r1', amountCny: 100 }])
  })
  it('does not deduct the same item when its completed charge already exists', () => {
    const debit = { details: { lines: [{ sourcePurchaseItemId: 'other', purchaseManagementCode: 'BUY1', sku: 'SKU1' }] } }
    expect(buildRequestedFundCharges([row()], [debit], 200)).toEqual([])
  })
  it('keeps completed requests without supplier references until a durable debit can represent them', () => {
    expect(buildRequestedFundCharges([row({ status: 'purchase_completed' })], [], 200)).toHaveLength(1)
    expect(buildRequestedFundCharges([row({ status: 'purchase_completed', supplierOrderNumber: '12345678' })], [], 200)).toEqual([])
  })
  it('does not include review-stage or pre-November orders', () => {
    expect(buildRequestedFundCharges([row({ status: 'requested' }), row({ id: 'old', requestDate: '2026-10-31' })], [], 200)).toEqual([])
  })
  it('flags missing cost instead of representing the amount as zero', () => {
    expect(buildRequestedFundCharges([row({ specialPriceCny: null })], [], 200)[0].amountCny).toBeNull()
  })
  it('uses a unique supplier order and SKU as a fallback when management codes are absent', () => {
    const debit = { supplierOrderNumber: '3316362603001063953', details: { lines: [{ sku: 'SKU1', sourcePurchaseItemId: 'other' }] } }
    expect(buildRequestedFundCharges([row({ purchaseManagementCode: null, supplierOrderNumber: '3316362603001063953' })], [debit], 200)).toEqual([])
  })
  it('does not collapse distinct requests with no reliable shared identifier', () => {
    expect(buildRequestedFundCharges([row({ purchaseManagementCode: null }), row({ id: 'r2', purchaseManagementCode: null })], [], 200)).toHaveLength(2)
    expect(buildRequestedFundCharges([row({ purchaseManagementCode: null }), row({ id: 'r2', purchaseManagementCode: null })], [], 200).every((charge) => charge.ambiguous && charge.amountCny === null)).toBe(true)
  })
  it('marks a possible legacy duplicate unknown instead of double charging', () => {
    const oldDebit = { details: { lines: [{ sku: 'SKU1', sourcePurchaseItemId: 'old' }] }, supplierOrderNumber: null }
    expect(buildRequestedFundCharges([row()], [oldDebit], 200)[0]).toMatchObject({ ambiguous: true, amountCny: null })
  })
  it('does not merge different management codes in the same supplier order', () => {
    const debit = { details: { lines: [{ sku: 'SKU1', purchaseManagementCode: 'BUY2' }] }, supplierOrderNumber: '3316362603001063953' }
    expect(buildRequestedFundCharges([row({ supplierOrderNumber: '3316362603001063953' })], [debit], 200)[0].amountCny).toBe(100)
  })
  it('includes requests dated after an opening even when the row was created before it', () => {
    const opening = new Date('2026-11-02T03:00:00Z')
    expect(requestedChargeOpeningBoundary({ requestDate: '2026-11-03', createdAt: '2026-11-01T00:00:00Z' }, opening)).toBe('include')
    expect(requestedChargeOpeningBoundary({ requestDate: '2026-11-01', createdAt: '2026-11-01T00:00:00Z' }, opening)).toBe('exclude')
    expect(requestedChargeOpeningBoundary({ requestDate: '2026-11-02', createdAt: '2026-11-01T00:00:00Z' }, opening)).toBe('uncertain')
    expect(requestedChargeOpeningBoundary({ requestDate: null, createdAt: '2026-11-01T00:00:00Z' }, opening)).toBe('uncertain')
  })
})

