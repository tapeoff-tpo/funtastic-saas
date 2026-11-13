import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dbMock } = vi.hoisted(() => ({ dbMock: { execute: vi.fn(), select: vi.fn() } }))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('./purchase-payment-tracking', () => ({ ensurePurchasePaymentTrackingSchema: vi.fn(async () => {}) }))

import { getPurchaseFundLedgerData, type PurchaseFundDebitSourceRow } from './purchase-fund-ledger'

const candidate = (partial: Partial<PurchaseFundDebitSourceRow>): PurchaseFundDebitSourceRow => ({
  id: 'request', status: 'purchased', requestDate: '2026-11-04', outboundExpectedDate: null, createdAt: new Date('2026-11-04T00:00:00Z'), sku: 'B', productName: '상품 B', optionName: null, requestedQuantity: 20, actualPurchaseQuantity: null, purchaseManagementCode: 'BUY-B', supplierOrderNumber: null, costExchangeRateKrw: null, specialPriceCny: '10', newCostCny: null, rawData: {}, ...partial,
})

function mockRows(rows: unknown[], sources: PurchaseFundDebitSourceRow[]) {
  dbMock.select.mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) })
  dbMock.select.mockReturnValueOnce({ from: () => ({ leftJoin: () => ({ where: async () => sources }) }) })
}

describe('purchase fund overview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.execute.mockResolvedValue([{ hasTable: true, hasSourceKeyIndex: true, hasOccurredOnIndex: true, hasRls: true }])
  })

  it('adds a request without counting its already-recorded completed order twice', async () => {
    mockRows([
      { id: 'deposit', entryType: 'deposit', occurredOn: '2026-11-01', amountKrw: '0', amountCny: '1000', memo: null, supplierOrderNumber: null, missingCostCount: 0, details: {}, voidedAt: null, createdAt: new Date('2026-11-01T00:00:00Z') },
      { id: 'debit', entryType: 'purchase_debit', occurredOn: '2026-11-03', amountKrw: '21000', amountCny: '100', memo: null, supplierOrderNumber: '3316362603001063953', missingCostCount: 0, details: { lines: [{ sourcePurchaseItemId: 'old-a', purchaseManagementCode: 'BUY-A', sku: 'A', productName: '상품 A', totalCostYuan: 100 }] }, voidedAt: null, createdAt: new Date('2026-11-03T00:00:00Z') },
    ], [candidate({ id: 'a', sku: 'A', purchaseManagementCode: 'BUY-A' }), candidate({})])
    const result = await getPurchaseFundLedgerData('workspace', 100, 200)
    expect(result.summary).toMatchObject({ totalDepositedCny: 1000, totalDebitedCny: 300, balanceCny: 700 })
    expect(result.monthly[0]).toMatchObject({ depositedCny: 1000, debitedCny: 300 })
  })

  it('does not present a definite balance when an old request and opening have an ambiguous same-day order', async () => {
    mockRows([{ id: 'opening', entryType: 'opening_balance', occurredOn: '2026-11-04', amountKrw: '0', amountCny: '1000', memo: null, supplierOrderNumber: null, missingCostCount: 0, details: {}, voidedAt: null, createdAt: new Date('2026-11-04T03:00:00Z') }], [candidate({ createdAt: new Date('2026-11-01T00:00:00Z'), requestDate: '2026-11-04' })])
    const result = await getPurchaseFundLedgerData('workspace', 100, 200)
    expect(result.summary).toMatchObject({ totalDebitedCny: null, balanceCny: null, missingCostOrderCount: 1 })
  })

  it('keeps an existing debit but does not add an outbound-completed copy', async () => {
    mockRows([
      { id: 'deposit', entryType: 'deposit', occurredOn: '2026-11-01', amountKrw: '0', amountCny: '1000', memo: null, supplierOrderNumber: null, missingCostCount: 0, details: {}, voidedAt: null, createdAt: new Date('2026-11-01T00:00:00Z') },
      { id: 'debit', entryType: 'purchase_debit', occurredOn: '2026-11-03', amountKrw: '21000', amountCny: '100', memo: null, supplierOrderNumber: '3316362603001063953', missingCostCount: 0, details: { lines: [{ sourcePurchaseItemId: 'original', purchaseManagementCode: 'BUY-B', sku: 'B', productName: '상품 B', totalCostYuan: 100 }] }, voidedAt: null, createdAt: new Date('2026-11-03T00:00:00Z') },
    ], [candidate({ id: 'outbound-copy', status: 'completed', purchaseManagementCode: 'BUY-B', supplierOrderNumber: null })])
    const result = await getPurchaseFundLedgerData('workspace', 100, 200)
    expect(result.summary).toMatchObject({ totalDepositedCny: 1000, totalDebitedCny: 100, balanceCny: 900 })
  })

  it('does not present an inflated balance when an outbound-completed row has no linkable original charge', async () => {
    mockRows([{ id: 'deposit', entryType: 'deposit', occurredOn: '2026-11-01', amountKrw: '0', amountCny: '1000', memo: null, supplierOrderNumber: null, missingCostCount: 0, details: {}, voidedAt: null, createdAt: new Date('2026-11-01T00:00:00Z') }], [candidate({ id: 'outbound-copy', status: 'completed', purchaseManagementCode: null, supplierOrderNumber: null })])
    const result = await getPurchaseFundLedgerData('workspace', 100, 200)
    expect(result.summary).toMatchObject({ totalDebitedCny: null, balanceCny: null })
    expect(result.requestReviewItems).toMatchObject([{ id: 'outbound-copy', reason: '출고완료 전 기존 차감 기록 확인' }])
  })
})

