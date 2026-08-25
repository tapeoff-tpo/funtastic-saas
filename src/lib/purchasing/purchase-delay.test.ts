import { describe, expect, it } from 'vitest'
import {
  isDiscontinuedPurchasingStatus,
  isPurchaseDelayTrackingDate,
  purchaseDelayReasonToItemStatus,
  PURCHASE_DELAY_TRACKING_START_DATE,
} from './purchase-delay'

describe('purchase delay tracking date', () => {
  it('starts with purchase requests dated July 1, 2026', () => {
    expect(PURCHASE_DELAY_TRACKING_START_DATE).toBe('2026-07-01')
    expect(isPurchaseDelayTrackingDate('2026-06-30')).toBe(false)
    expect(isPurchaseDelayTrackingDate('2026-07-01')).toBe(true)
    expect(isPurchaseDelayTrackingDate('2026-07-02')).toBe(true)
  })

  it('does not track rows without a purchase request date', () => {
    expect(isPurchaseDelayTrackingDate(null)).toBe(false)
    expect(isPurchaseDelayTrackingDate(undefined)).toBe(false)
  })
})

describe('purchase delay reason item sync', () => {
  it('maps discontinued items to a purchasing status that excludes recommendations', () => {
    expect(purchaseDelayReasonToItemStatus('discontinued')).toBe('discontinued')
    expect(isDiscontinuedPurchasingStatus('discontinued')).toBe(true)
    expect(isDiscontinuedPurchasingStatus('supplier_changed')).toBe(false)
  })

  it('maps a resolved delay back to the normal purchasing status', () => {
    expect(purchaseDelayReasonToItemStatus('resolved')).toBe('active')
    expect(purchaseDelayReasonToItemStatus('other')).toBe('under_review')
  })
})
