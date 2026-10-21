export const URGENT_PURCHASE_MAX_STOCK_COVERAGE_MONTHS = 1

export const PURCHASE_URGENCY_STATUS_LABELS = {
  urgent: '긴급구매',
} as const

export type PurchaseUrgencyStatus = keyof typeof PURCHASE_URGENCY_STATUS_LABELS

export function getPurchaseStockCoverageMonths(rawData: unknown): number | null {
  if (!isAutoPurchaseRecommendation(rawData)) return null

  const value = rawData.stockCoverageMonths
  if (typeof value === 'string' && !value.trim()) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null

  const coverageMonths = Number(value)
  return Number.isFinite(coverageMonths) ? coverageMonths : null
}

export function getPurchaseUrgencyStatus(rawData: unknown): PurchaseUrgencyStatus | null {
  const coverageMonths = getPurchaseStockCoverageMonths(rawData)
  if (coverageMonths === null || coverageMonths > URGENT_PURCHASE_MAX_STOCK_COVERAGE_MONTHS) return null
  return 'urgent'
}

function isAutoPurchaseRecommendation(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && value.source === 'auto_purchase_recommendation'
}
