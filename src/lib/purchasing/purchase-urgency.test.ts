import { describe, expect, it } from 'vitest'
import {
  getPurchaseStockCoverageMonths,
  getPurchaseUrgencyStatus,
  PURCHASE_URGENCY_STATUS_LABELS,
} from './purchase-urgency'

describe('purchase urgency status', () => {
  it('marks auto-recommended products with one month or less of stock as urgent', () => {
    expect(getPurchaseUrgencyStatus({
      source: 'auto_purchase_recommendation',
      stockCoverageMonths: 1,
    })).toBe('urgent')
    expect(getPurchaseUrgencyStatus({
      source: 'auto_purchase_recommendation',
      stockCoverageMonths: -0.3,
    })).toBe('urgent')
    expect(PURCHASE_URGENCY_STATUS_LABELS.urgent).toBe('긴급구매')
  })

  it('does not mark stock above one month or manual rows as urgent', () => {
    expect(getPurchaseUrgencyStatus({
      source: 'auto_purchase_recommendation',
      stockCoverageMonths: 1.1,
    })).toBeNull()
    expect(getPurchaseUrgencyStatus({
      source: 'purchase_request_excel',
      stockCoverageMonths: 0.5,
    })).toBeNull()
    expect(getPurchaseUrgencyStatus({
      source: 'auto_purchase_recommendation',
      stockCoverageMonths: '',
    })).toBeNull()
  })

  it('reads the recorded stock coverage only from automatic recommendation data', () => {
    expect(getPurchaseStockCoverageMonths({
      source: 'auto_purchase_recommendation',
      stockCoverageMonths: '0.8',
    })).toBe(0.8)
    expect(getPurchaseStockCoverageMonths({
      source: 'purchase_request_excel',
      stockCoverageMonths: 0.8,
    })).toBeNull()
  })
})
