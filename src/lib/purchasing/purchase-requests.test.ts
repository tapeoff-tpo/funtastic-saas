import { describe, expect, it } from 'vitest'
import {
  getPurchasePaymentFlowViewSummary,
  isPurchasePaymentFlowViewItem,
  getOutboundRequestedQuantity,
  normalizeOptionalPurchaseRequestQuantity,
  normalizePurchaseRequestQuantity,
  purchaseRequestOrderBy,
  sortPurchasePaymentFlowItems,
} from './purchase-requests'
import { PURCHASE_REQUEST_STATUS_LABELS } from './purchase-request-status'

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
  const purchaseBefore = { status: 'purchased' as const, paymentStatus: 'pending' }
  const purchaseCompleted = { status: 'purchase_completed' as const, paymentStatus: 'pending' }
  const paid = { status: 'china_arrived' as const, paymentStatus: 'paid' }
  const beforeOutbound = { status: 'outbound_requested' as const, paymentStatus: 'before_outbound' }

  it('keeps each money tab aligned with its summary calculation', () => {
    expect(isPurchasePaymentFlowViewItem(purchaseBefore, 'purchase_before')).toBe(true)
    expect(isPurchasePaymentFlowViewItem(purchaseCompleted, 'purchase_completed')).toBe(true)
    expect(isPurchasePaymentFlowViewItem(purchaseCompleted, 'payment_pending')).toBe(true)
    expect(isPurchasePaymentFlowViewItem(paid, 'outstanding')).toBe(false)
    expect(isPurchasePaymentFlowViewItem(paid, 'payment_paid')).toBe(true)
    expect(isPurchasePaymentFlowViewItem(beforeOutbound, 'before_outbound')).toBe(true)
    expect(isPurchasePaymentFlowViewItem({ status: 'china_arrived', paymentStatus: null }, 'payment_pending')).toBe(true)
    expect(isPurchasePaymentFlowViewItem({ status: 'china_arrived', paymentStatus: 'unknown' }, 'payment_pending')).toBe(true)
  })

  it('uses the matching summary total for every money tab', () => {
    const summary = {
      total: { itemCount: 1, totalCostYuan: 1, totalCostKrw: 1, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      purchaseBefore: { itemCount: 2, totalCostYuan: 2, totalCostKrw: 2, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      purchaseCompleted: { itemCount: 3, totalCostYuan: 3, totalCostKrw: 3, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      paymentPending: { itemCount: 4, totalCostYuan: 4, totalCostKrw: 4, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      paymentPaid: { itemCount: 5, totalCostYuan: 5, totalCostKrw: 5, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      beforeOutbound: { itemCount: 6, totalCostYuan: 6, totalCostKrw: 6, missingYuanCostCount: 0, missingKrwCostCount: 0 },
      outstanding: { itemCount: 7, totalCostYuan: 7, totalCostKrw: 7, missingYuanCostCount: 0, missingKrwCostCount: 0 },
    }

    expect(getPurchasePaymentFlowViewSummary(summary, 'total').itemCount).toBe(1)
    expect(getPurchasePaymentFlowViewSummary(summary, 'purchase_before').itemCount).toBe(2)
    expect(getPurchasePaymentFlowViewSummary(summary, 'purchase_completed').itemCount).toBe(3)
    expect(getPurchasePaymentFlowViewSummary(summary, 'payment_pending').itemCount).toBe(4)
    expect(getPurchasePaymentFlowViewSummary(summary, 'payment_paid').itemCount).toBe(5)
    expect(getPurchasePaymentFlowViewSummary(summary, 'before_outbound').itemCount).toBe(6)
    expect(getPurchasePaymentFlowViewSummary(summary, 'outstanding').itemCount).toBe(7)
  })
})

describe('purchase payment flow ordering', () => {
  const paymentFlowItems = [
    { id: 'first', sku: '100001-0001', totalCostYuan: 30, totalCostKrw: 5_000 },
    { id: 'missing', sku: '100002-0001', totalCostYuan: null, totalCostKrw: null },
    { id: 'last', sku: '100003-0001', totalCostYuan: 10, totalCostKrw: 2_000 },
  ] as Parameters<typeof sortPurchasePaymentFlowItems>[0]

  it('sorts total amounts without moving missing costs ahead of known amounts', () => {
    expect(sortPurchasePaymentFlowItems(paymentFlowItems, 'totalCostKrw', 'asc').map((item) => item.id))
      .toEqual(['last', 'first', 'missing'])
    expect(sortPurchasePaymentFlowItems(paymentFlowItems, 'totalCostYuan', 'desc').map((item) => item.id))
      .toEqual(['first', 'last', 'missing'])
  })
})
