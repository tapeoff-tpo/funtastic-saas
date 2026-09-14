import { describe, expect, it } from 'vitest'
import {
  buildPurchaseDebitSnapshots,
  type PurchaseFundDebitSourceRow,
} from './purchase-fund-ledger'

function row(overrides: Partial<PurchaseFundDebitSourceRow> = {}): PurchaseFundDebitSourceRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'purchase_completed',
    requestDate: '2026-09-01',
    outboundExpectedDate: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    sku: '100000-0001',
    productName: '테스트 상품',
    optionName: '기본',
    requestedQuantity: 100,
    actualPurchaseQuantity: 100,
    purchaseManagementCode: 'BUY-001',
    supplierOrderNumber: '3316362603001063953',
    costExchangeRateKrw: null,
    specialPriceCny: '10',
    newCostCny: '12',
    rawData: {},
    ...overrides,
  }
}

describe('purchase fund debit snapshots', () => {
  it('collapses lifecycle copies and uses the full purchased quantity for partial outbound rows', () => {
    const snapshots = buildPurchaseDebitSnapshots([
      row(),
      row({
        id: '22222222-2222-4222-8222-222222222222',
        status: 'outbound_requested',
        requestedQuantity: 40,
        actualPurchaseQuantity: 40,
        requestDate: '2026-09-05',
        rawData: { purchasedQuantity: 100 },
      }),
    ], 200)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      supplierOrderNumber: '3316362603001063953',
      occurredOn: '2026-09-01',
      amountCny: 1_000,
      amountKrw: 210_000,
      missingCostCount: 0,
    })
    expect(snapshots[0]?.details).toMatchObject({ lineCount: 1 })
  })

  it('adds distinct management-code lines inside one supplier order', () => {
    const snapshots = buildPurchaseDebitSnapshots([
      row(),
      row({
        id: '33333333-3333-4333-8333-333333333333',
        sku: '100000-0002',
        productName: '두 번째 상품',
        purchaseManagementCode: 'BUY-002',
        requestedQuantity: 50,
        actualPurchaseQuantity: 50,
        specialPriceCny: '4',
      }),
    ], 200)

    expect(snapshots[0]).toMatchObject({
      amountCny: 1_200,
      amountKrw: 252_000,
      missingCostCount: 0,
    })
    expect(snapshots[0]?.details).toMatchObject({ lineCount: 2 })
  })

  it('keeps known totals while flagging lines whose cost is missing', () => {
    const snapshots = buildPurchaseDebitSnapshots([
      row(),
      row({
        id: '44444444-4444-4444-8444-444444444444',
        sku: '100000-0003',
        purchaseManagementCode: 'BUY-003',
        specialPriceCny: null,
        newCostCny: null,
      }),
    ], 200)

    expect(snapshots[0]).toMatchObject({
      amountCny: 1_000,
      amountKrw: 210_000,
      missingCostCount: 1,
    })
  })

  it('ignores rows without a supplier order number and separates different orders', () => {
    const snapshots = buildPurchaseDebitSnapshots([
      row({ supplierOrderNumber: null }),
      row(),
      row({
        id: '55555555-5555-4555-8555-555555555555',
        supplierOrderNumber: '3316362603001063954',
      }),
    ], 200)

    expect(snapshots.map((snapshot) => snapshot.supplierOrderNumber)).toEqual([
      '3316362603001063953',
      '3316362603001063954',
    ])
  })

  it('separates reused text references by purchase management code', () => {
    const snapshots = buildPurchaseDebitSnapshots([
      row({ supplierOrderNumber: '웨이신' }),
      row({
        id: '66666666-6666-4666-8666-666666666666',
        supplierOrderNumber: '웨이신',
        purchaseManagementCode: 'BUY-002',
      }),
    ], 200)

    expect(snapshots).toHaveLength(2)
    expect(new Set(snapshots.map((snapshot) => snapshot.sourceKey)).size).toBe(2)
    expect(snapshots.every((snapshot) => snapshot.supplierOrderNumber === '웨이신')).toBe(true)
  })

  it('collapses lifecycle copies carrying the same text reference and management code', () => {
    const snapshots = buildPurchaseDebitSnapshots([
      row({ supplierOrderNumber: 'wechat' }),
      row({
        id: '77777777-7777-4777-8777-777777777777',
        status: 'china_arrived',
        supplierOrderNumber: 'wechat',
      }),
    ], 200)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      supplierOrderNumber: 'wechat',
      amountCny: 1_000,
      amountKrw: 210_000,
    })
  })
})
