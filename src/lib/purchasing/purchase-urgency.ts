export const URGENT_PURCHASE_MAX_STOCK_COVERAGE_MONTHS = 1

export const PURCHASE_URGENCY_STATUS_LABELS = {
  urgent: '긴급구매',
} as const

export type PurchaseUrgencyStatus = keyof typeof PURCHASE_URGENCY_STATUS_LABELS

export type PurchaseUrgencyProduct = {
  sku?: string
  productName: string
  rawData: unknown
}

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

/**
 * Purchase urgency is a product-level decision. When one option has one
 * month or less of stock, its sibling options must be reviewed together.
 */
export function getUrgentPurchaseProductNames(rows: readonly PurchaseUrgencyProduct[]) {
  const keys = new Set<string>()
  for (const row of rows) {
    if (getPurchaseUrgencyStatus(row.rawData) !== 'urgent') continue
    getPurchaseUrgencyGroupKeys(row).forEach((key) => keys.add(key))
  }
  return keys
}

export function getProductGroupPurchaseUrgencyStatus(input: {
  sku?: string
  productName: string
  urgentProductNames: ReadonlySet<string>
}): PurchaseUrgencyStatus | null {
  return getPurchaseUrgencyGroupKeys(input).some((key) => input.urgentProductNames.has(key))
    ? 'urgent'
    : null
}

export function normalizePurchaseUrgencyProductName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
}

function getPurchaseUrgencyGroupKeys(input: Pick<PurchaseUrgencyProduct, 'sku' | 'productName'>) {
  const keys: string[] = []
  const skuPrefix = input.sku?.trim().match(/^(.+)-[^-]+$/)?.[1]
  if (skuPrefix) keys.push(`sku:${skuPrefix}`)

  const productName = normalizePurchaseUrgencyProductName(input.productName)
  if (productName) keys.push(`product:${productName}`)
  return keys
}

function isAutoPurchaseRecommendation(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return (value as Record<string, unknown>).source === 'auto_purchase_recommendation'
}
