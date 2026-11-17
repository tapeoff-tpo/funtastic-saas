import { describe, expect, it, vi } from 'vitest'
import { buildMissingCompletionSnapshots, excludeCapturedCompletionRows, recordPurchaseCompletionInTransaction, type PurchaseFundDebitSourceRow } from './purchase-fund-ledger'

function purchase(partial: Partial<PurchaseFundDebitSourceRow> = {}): PurchaseFundDebitSourceRow {
  return { id: '11111111-1111-4111-8111-111111111111', status: 'purchase_completed', requestDate: '2026-11-16',
    outboundExpectedDate: null, createdAt: '2026-11-16T00:00:00Z', sku: 'SKU1', productName: '상품', optionName: null,
    requestedQuantity: 10, actualPurchaseQuantity: 10, purchaseManagementCode: 'BUY1', supplierOrderNumber: null,
    costExchangeRateKrw: '210', specialPriceCny: '10', newCostCny: null, rawData: {}, ...partial }
}

function mockTransaction(item: PurchaseFundDebitSourceRow, prior = false) {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn(() => ({ onConflictDoNothing }))
  const tx = {
    execute: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(prior ? [{ found: 1 }] : []),
    select: vi.fn(() => ({ from: () => ({ leftJoin: () => ({ where: async () => [item] }) }) })),
    insert: vi.fn(() => ({ values })),
  }
  return { tx, values, onConflictDoNothing }
}

describe('purchase completion snapshots', () => {
  it('records the cost at purchase completion even without a supplier order number', async () => {
    const { tx, values, onConflictDoNothing } = mockTransaction(purchase())
    await recordPurchaseCompletionInTransaction(tx as never, { userId: '00000000-0000-4000-8000-000000000001', itemId: purchase().id, fallbackExchangeRateKrw: 200, occurredOn: '2026-11-17' })
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ sourceKey: `completion:${purchase().id}`, amountCny: '100', occurredOn: '2026-11-17', sourcePurchaseItemId: purchase().id }))
    expect(onConflictDoNothing).toHaveBeenCalledOnce()
  })
  it('does not insert another debit if the purchase is already represented', async () => {
    const { tx, values } = mockTransaction(purchase(), true)
    await recordPurchaseCompletionInTransaction(tx as never, { userId: '00000000-0000-4000-8000-000000000001', itemId: purchase().id, fallbackExchangeRateKrw: 200, occurredOn: '2026-11-17' })
    expect(values).not.toHaveBeenCalled()
  })
  it('keeps the saved debit separate from subsequent shipment copies and allows a distinct reorder', () => {
    const captured = [{ item_id: purchase().id, supplier_order_number: null, details: { lines: [{ sourcePurchaseItemId: purchase().id, sku: 'SKU1', purchaseManagementCode: 'BUY1' }] } }]
    const shipped = purchase({ id: '22222222-2222-4222-8222-222222222222', status: 'completed' })
    const reorder = purchase({ id: '33333333-3333-4333-8333-333333333333', purchaseManagementCode: 'BUY2' })
    expect(excludeCapturedCompletionRows([purchase(), shipped, reorder], captured)).toEqual([reorder])
  })
  it('does not treat two different management codes as the same purchase even if the supplier number matches', () => {
    const captured = [{ item_id: purchase().id, supplier_order_number: '3316362603001063953', details: { lines: [{ sku: 'SKU1', purchaseManagementCode: 'BUY1' }] } }]
    const reordered = purchase({ id: '33333333-3333-4333-8333-333333333333', purchaseManagementCode: 'BUY2', supplierOrderNumber: '3316362603001063953' })
    expect(excludeCapturedCompletionRows([reordered], captured)).toEqual([reordered])
  })
  it('recognizes an unnumbered shipment copy from the same request date and SKU', () => {
    const captured = [{ item_id: purchase().id, supplier_order_number: null, details: { lines: [{ sku: 'SKU1', purchaseManagementCode: 'BUY1', requestDate: '2026-11-16' }] } }]
    const copy = purchase({ id: '22222222-2222-4222-8222-222222222222', status: 'completed', purchaseManagementCode: null })
    expect(excludeCapturedCompletionRows([copy], captured)).toEqual([])
  })
  it('does not record an item before purchase completion', async () => {
    const { tx, values } = mockTransaction(purchase({ status: 'purchased' }))
    await recordPurchaseCompletionInTransaction(tx as never, { userId: '00000000-0000-4000-8000-000000000001', itemId: purchase().id, fallbackExchangeRateKrw: 200, occurredOn: '2026-11-17' })
    expect(values).not.toHaveBeenCalled()
  })
  it('backfills a completed purchase without an order number while ignoring requests and pre-November records', () => {
    const rows = [purchase(), purchase({ id: 'request', status: 'purchased' }), purchase({ id: 'old', requestDate: '2026-10-31' })]
    expect(buildMissingCompletionSnapshots(rows, [], 'workspace', 200)).toMatchObject([{ sourceKey: `completion:${purchase().id}`, amountCny: '100' }])
  })
  it('does not backfill a second time when an existing legacy debit already represents the purchase', () => {
    const old = [{ item_id: 'old-copy', supplier_order_number: null, details: { lines: [{ sku: 'SKU1', purchaseManagementCode: 'BUY1' }] } }]
    expect(buildMissingCompletionSnapshots([purchase()], old, 'workspace', 200)).toEqual([])
  })
})
