import { describe, expect, it } from 'vitest'
import {
  calculateBulkPaymentBalance,
  getPurchasePaymentFlowViewSummary,
  isPurchasePaymentFlowViewItem,
  getOutboundRequestedQuantity,
  normalizeOptionalPurchaseRequestQuantity,
  normalizePurchaseRequestQuantity,
  PURCHASE_PAYMENT_FLOW_VIEWS,
  purchaseRequestOrderBy,
  sortPurchasePaymentFlowItems,
} from './purchase-requests'
import { PURCHASE_REQUEST_STATUS_LABELS } from './purchase-request-status'
import { completedOutboundCleanupCutoffDate } from './reflected-outbound-items'

describe('completed outbound cleanup cutoff', () => {
  it('uses the KST calendar date and includes rows exactly 14 days old', () => {
    expect(completedOutboundCleanupCutoffDate(new Date('2026-09-09T14:59:59.999Z'))).toBe('2026-08-26')
    expect(completedOutboundCleanupCutoffDate(new Date('2026-09-09T15:00:00.000Z'))).toBe('2026-08-27')
  })
})

describe('normalize purchase request quantity', () => {
  it('accepts positive integer quantities', () => {
    expect(normalizePurchaseRequestQuantity(25)).toBe(25)
    expect(normalizePurchaseRequestQuantity('12')).toBe(12)
  })

  it('rejects empty, zero, decimal, and negative quantities', () => {
    expect(normalizePurchaseRequestQuantity(undefined)).toBeUndefined()
    expect(normalizePurchaseRequestQuantity('')).toBeUndefined()
    expect(normalizePurchaseRequestQuantity(0)).toBeNull()
    expect(normalizePurchaseRequestQuantity(1.5)).toBeNull()
    expect(normalizePurchaseRequestQuantity(-1)).toBeNull()
  })
})

describe('normalize optional purchase request quantity', () => {
  it('accepts zero or positive integer stage quantities', () => {
    expect(normalizeOptionalPurchaseRequestQuantity(0)).toBe(0)
    expect(normalizeOptionalPurchaseRequestQuantity('12')).toBe(12)
  })

  it('rejects empty, decimal, and negative stage quantities', () => {
    expect(normalizeOptionalPurchaseRequestQuantity(undefined)).toBeUndefined()
    expect(normalizeOptionalPurchaseRequestQuantity('')).toBeNull()
    expect(normalizeOptionalPurchaseRequestQuantity(1.5)).toBeNull()
    expect(normalizeOptionalPurchaseRequestQuantity(-1)).toBeNull()
  })
})

describe('purchase request stage quantities', () => {
  it('reads outbound requested quantity from raw data and falls back to received or purchased quantity', () => {
    expect(getOutboundRequestedQuantity({
      rawData: { outboundRequestedQuantity: 7 },
      chinaReceivedQuantity: 5,
      actualPurchaseQuantity: 3,
      requestedQuantity: 1,
    })).toBe(7)
    expect(getOutboundRequestedQuantity({
      rawData: {},
      chinaReceivedQuantity: 5,
      actualPurchaseQuantity: 3,
      requestedQuantity: 1,
    })).toBe(5)
    expect(getOutboundRequestedQuantity({
      rawData: {},
      chinaReceivedQuantity: null,
      actualPurchaseQuantity: 3,
      requestedQuantity: 1,
    })).toBe(3)
  })
})

describe('purchase request status labels', () => {
  it('labels completed purchase requests as outbound completed', () => {
    expect(PURCHASE_REQUEST_STATUS_LABELS.completed).toBe('중국출고완료')
  })

  it('labels the post-purchase stage as purchase completed', () => {
    expect(PURCHASE_REQUEST_STATUS_LABELS.purchase_completed).toBe('구매완료')
  })
})

describe('purchase request ordering', () => {
  it('defaults to newest first when no supported sort is selected', () => {
    expect(purchaseRequestOrderBy()).toHaveLength(5)
    expect(purchaseRequestOrderBy('unknown')).toHaveLength(5)
  })

  it('adds stable tie-breakers for supported sorts', () => {
    expect(purchaseRequestOrderBy('requestedQuantity', 'asc')).toHaveLength(2)
    expect(purchaseRequestOrderBy('productName', 'desc')).toHaveLength(3)
    expect(purchaseRequestOrderBy('totalCostKrw', 'asc')).toHaveLength(2)
  })
})

describe('purchase payment flow views', () => {
  const purchaseBefore = { status: 'purchased' as const, supplierOrderNumber: null }
  const purchaseCompleted = {
    status: 'purchase_completed' as const,
    supplierOrderNumber: '3316362603001063953',
  }

  it('exposes stage views separately from order-number and bulk-payment views', () => {
    expect(PURCHASE_PAYMENT_FLOW_VIEWS).toEqual([
      'total',
      'purchase_before',
      'purchase_completed',
      'china_arrived',
      'outbound_requested',
      'order_number_registered',
      'outstanding',
      'bulk_pending',
    ])
  })

  it('treats an orderless purchase request as both purchase-before and outstanding', () => {
    expect(isPurchasePaymentFlowViewItem(purchaseBefore, 'purchase_before')).toBe(true)
    expect(isPurchasePaymentFlowViewItem(purchaseBefore, 'outstanding')).toBe(true)
    expect(isPurchasePaymentFlowViewItem(purchaseBefore, 'purchase_completed')).toBe(false)
  })

  it('classifies each operational stage by status regardless of order-number registration', () => {
    const stageViews = [
      ['purchased', 'purchase_before'],
      ['purchase_completed', 'purchase_completed'],
      ['china_arrived', 'china_arrived'],
      ['outbound_requested', 'outbound_requested'],
    ] as const

    for (const [status, view] of stageViews) {
      for (const supplierOrderNumber of [null, '3316362603001063953']) {
        const item = { status, supplierOrderNumber }
        expect(isPurchasePaymentFlowViewItem(item, view)).toBe(true)
        expect(isPurchasePaymentFlowViewItem(item, 'total')).toBe(true)
      }
    }

    expect(isPurchasePaymentFlowViewItem(purchaseCompleted, 'purchase_completed')).toBe(true)
    expect(isPurchasePaymentFlowViewItem(purchaseCompleted, 'china_arrived')).toBe(false)
  })

  it('groups all active stages by order-number registration separately from operational stages', () => {
    const activeStatuses = [
      'purchased',
      'purchase_completed',
      'china_arrived',
      'outbound_requested',
    ] as const

    for (const status of activeStatuses) {
      const registered = { status, supplierOrderNumber: '3316362603001063953' }
      expect(isPurchasePaymentFlowViewItem(registered, 'order_number_registered')).toBe(true)
      expect(isPurchasePaymentFlowViewItem(registered, 'outstanding')).toBe(false)

      const unregistered = { status, supplierOrderNumber: null }
      expect(isPurchasePaymentFlowViewItem(unregistered, 'order_number_registered')).toBe(false)
      expect(isPurchasePaymentFlowViewItem(unregistered, 'outstanding')).toBe(true)
    }
  })

  it('treats null, empty, and whitespace-only order numbers as outstanding', () => {
    for (const supplierOrderNumber of [null, '', '   ']) {
      const item = { status: 'china_arrived' as const, supplierOrderNumber }
      expect(isPurchasePaymentFlowViewItem(item, 'outstanding')).toBe(true)
      expect(isPurchasePaymentFlowViewItem(item, 'purchase_completed')).toBe(false)
    }
  })

  it.each(['웨이신', '알리페이', 'wechat', 'ssj', '신성진'])(
    'treats the text order reference %s as order-number registered',
    (supplierOrderNumber) => {
      const item = { status: 'china_arrived' as const, supplierOrderNumber }
      expect(isPurchasePaymentFlowViewItem(item, 'order_number_registered')).toBe(true)
      expect(isPurchasePaymentFlowViewItem(item, 'outstanding')).toBe(false)
    },
  )

  it('keeps paid items out of payment queues without changing their operational stage', () => {
    expect(isPurchasePaymentFlowViewItem({
      status: 'china_arrived',
      supplierOrderNumber: null,
      paymentStatus: 'paid',
    }, 'outstanding')).toBe(false)
    expect(isPurchasePaymentFlowViewItem({
      status: 'china_arrived',
      supplierOrderNumber: null,
      paymentStatus: 'paid',
    }, 'china_arrived')).toBe(true)
    expect(isPurchasePaymentFlowViewItem({
      status: 'purchase_completed',
      supplierOrderNumber: null,
      paymentStatus: 'paid',
      bulkPaymentPending: true,
    }, 'bulk_pending')).toBe(false)
    expect(isPurchasePaymentFlowViewItem({
      status: 'purchase_completed',
      supplierOrderNumber: '3316362603001063953',
      paymentStatus: 'before_outbound',
    }, 'purchase_completed')).toBe(true)
    expect(isPurchasePaymentFlowViewItem({
      status: 'purchase_completed',
      supplierOrderNumber: null,
      paymentStatus: 'before_outbound',
    }, 'outstanding')).toBe(true)
  })

  it('keeps manually marked bulk payments out of ordinary outstanding', () => {
    const withoutOrder = {
      status: 'purchase_completed' as const,
      supplierOrderNumber: null,
      bulkPaymentPending: true,
    }
    const withOrder = {
      status: 'purchase_completed' as const,
      supplierOrderNumber: '3316362603001063953',
      bulkPaymentPending: true,
    }

    expect(isPurchasePaymentFlowViewItem(withoutOrder, 'outstanding')).toBe(false)
    expect(isPurchasePaymentFlowViewItem(withoutOrder, 'bulk_pending')).toBe(true)
    expect(isPurchasePaymentFlowViewItem(withOrder, 'purchase_completed')).toBe(true)
    expect(isPurchasePaymentFlowViewItem(withOrder, 'bulk_pending')).toBe(true)
  })

  it('uses the precomputed order-number flag for grouped summary rows', () => {
    expect(isPurchasePaymentFlowViewItem({
      status: 'purchase_completed',
      hasSupplierOrderNumber: true,
    }, 'order_number_registered')).toBe(true)
    expect(isPurchasePaymentFlowViewItem({
      status: 'purchase_completed',
      hasSupplierOrderNumber: false,
    }, 'outstanding')).toBe(true)
    expect(isPurchasePaymentFlowViewItem({
      status: 'purchase_completed',
      hasSupplierOrderNumber: false,
      bulkPaymentPending: true,
    }, 'outstanding')).toBe(false)
  })

  it('uses the matching summary total for each money view', () => {
    const summary = {
      total: { itemCount: 1, totalCostYuan: 1, totalCostKrw: 1, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      purchaseBefore: { itemCount: 2, totalCostYuan: 2, totalCostKrw: 2, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      purchaseCompleted: { itemCount: 3, totalCostYuan: 3, totalCostKrw: 3, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      chinaArrived: { itemCount: 4, totalCostYuan: 4, totalCostKrw: 4, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      outboundRequested: { itemCount: 5, totalCostYuan: 5, totalCostKrw: 5, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      orderNumberRegistered: { itemCount: 6, totalCostYuan: 6, totalCostKrw: 6, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      outstanding: { itemCount: 7, totalCostYuan: 7, totalCostKrw: 7, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      bulkPending: { itemCount: 8, totalCostYuan: 8, totalCostKrw: 8, missingYuanCostCount: 0, missingKrwCostCount: 0 },
    }

    expect(getPurchasePaymentFlowViewSummary(summary, 'total').itemCount).toBe(1)
    expect(getPurchasePaymentFlowViewSummary(summary, 'purchase_before').itemCount).toBe(2)
    expect(getPurchasePaymentFlowViewSummary(summary, 'purchase_completed').itemCount).toBe(3)
    expect(getPurchasePaymentFlowViewSummary(summary, 'china_arrived').itemCount).toBe(4)
    expect(getPurchasePaymentFlowViewSummary(summary, 'outbound_requested').itemCount).toBe(5)
    expect(getPurchasePaymentFlowViewSummary(summary, 'order_number_registered').itemCount).toBe(6)
    expect(getPurchasePaymentFlowViewSummary(summary, 'outstanding').itemCount).toBe(7)
    expect(getPurchasePaymentFlowViewSummary(summary, 'bulk_pending').itemCount).toBe(8)
  })
})

describe('bulk payment deposit balance', () => {
  it('subtracts a cumulative deposit from the bulk-payment balance in both currencies', () => {
    expect(calculateBulkPaymentBalance({
      totalCostYuan: 1_000,
      totalCostKrw: 210_000,
      bulkPaymentDepositCny: '300.5',
      bulkPaymentDepositKrw: '63,105',
    })).toEqual({
      depositCny: 300.5,
      depositKrw: 63_105,
      remainingCny: 699.5,
      remainingKrw: 146_895,
    })
  })

  it('does not show a negative balance if a later quantity edit makes an old deposit larger than the order', () => {
    expect(calculateBulkPaymentBalance({
      totalCostYuan: 100,
      totalCostKrw: 21_000,
      bulkPaymentDepositCny: 120,
      bulkPaymentDepositKrw: 25_200,
    })).toMatchObject({
      remainingCny: 0,
      remainingKrw: 0,
    })
  })
})

describe('purchase payment flow ordering', () => {
  const paymentFlowItems = [
    {
      id: 'first',
      sku: '100001-0001',
      productName: '다람쥐 수납장',
      optionName: '화이트',
      quantity: 30,
      unitCostYuan: 3,
      unitCostKrw: 500,
      supplierOrderNumber: 'ORDER-2',
      outboundExpectedDate: '2026-09-15',
      requestDate: null,
      totalCostYuan: 30,
      totalCostKrw: 5_000,
    },
    {
      id: 'missing',
      sku: '100002-0001',
      productName: '가구 정리함',
      optionName: '그레이',
      quantity: 5,
      unitCostYuan: null,
      unitCostKrw: null,
      supplierOrderNumber: null,
      outboundExpectedDate: null,
      requestDate: null,
      totalCostYuan: null,
      totalCostKrw: null,
    },
    {
      id: 'last',
      sku: '100003-0001',
      productName: '나무 수납장',
      optionName: '우드',
      quantity: 10,
      unitCostYuan: 1,
      unitCostKrw: 200,
      supplierOrderNumber: 'ORDER-1',
      outboundExpectedDate: '2026-09-14',
      requestDate: null,
      totalCostYuan: 10,
      totalCostKrw: 2_000,
    },
  ] as Parameters<typeof sortPurchasePaymentFlowItems>[0]

  it('sorts total amounts without moving missing costs ahead of known amounts', () => {
    expect(sortPurchasePaymentFlowItems(paymentFlowItems, 'totalCostKrw', 'asc').map((item) => item.id))
      .toEqual(['last', 'first', 'missing'])
    expect(sortPurchasePaymentFlowItems(paymentFlowItems, 'totalCostYuan', 'desc').map((item) => item.id))
      .toEqual(['first', 'last', 'missing'])
  })

  it('sorts the product table columns and keeps matching purchase dates together', () => {
    expect(sortPurchasePaymentFlowItems(paymentFlowItems, 'productName', 'asc').map((item) => item.id))
      .toEqual(['missing', 'last', 'first'])
    expect(sortPurchasePaymentFlowItems(paymentFlowItems, 'quantity', 'desc').map((item) => item.id))
      .toEqual(['first', 'last', 'missing'])
    expect(sortPurchasePaymentFlowItems(paymentFlowItems, 'unitCostYuan', 'asc').map((item) => item.id))
      .toEqual(['last', 'first', 'missing'])
    expect(sortPurchasePaymentFlowItems(paymentFlowItems, 'supplierOrderNumber', 'asc').map((item) => item.id))
      .toEqual(['last', 'first', 'missing'])
    expect(sortPurchasePaymentFlowItems(paymentFlowItems, null).map((item) => item.id))
      .toEqual(['first', 'last', 'missing'])
  })
})
