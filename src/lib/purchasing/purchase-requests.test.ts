import { describe, expect, it } from 'vitest'
import {
  normalizePurchaseRequestQuantity,
  purchaseRequestOrderBy,
} from './purchase-requests'

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

describe('purchase request ordering', () => {
  it('defaults to newest first when no supported sort is selected', () => {
    expect(purchaseRequestOrderBy()).toHaveLength(1)
    expect(purchaseRequestOrderBy('unknown')).toHaveLength(1)
  })

  it('adds stable tie-breakers for supported sorts', () => {
    expect(purchaseRequestOrderBy('requestedQuantity', 'asc')).toHaveLength(2)
    expect(purchaseRequestOrderBy('productName', 'desc')).toHaveLength(3)
  })
})
