import { describe, expect, it } from 'vitest'
import {
  getOutboundRequestedQuantity,
  normalizeOptionalPurchaseRequestQuantity,
  normalizePurchaseRequestQuantity,
  purchaseRequestOrderBy,
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
})

describe('purchase request ordering', () => {
  it('defaults to newest first when no supported sort is selected', () => {
    expect(purchaseRequestOrderBy()).toHaveLength(5)
    expect(purchaseRequestOrderBy('unknown')).toHaveLength(5)
  })

  it('adds stable tie-breakers for supported sorts', () => {
    expect(purchaseRequestOrderBy('requestedQuantity', 'asc')).toHaveLength(2)
    expect(purchaseRequestOrderBy('productName', 'desc')).toHaveLength(3)
  })
})
