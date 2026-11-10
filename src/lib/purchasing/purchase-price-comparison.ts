export const PURCHASE_PRICE_FIELDS = [
  'baselineUnitPriceCny',
  'baselineUnitShippingCny',
  'actualUnitPriceCny',
  'actualShippingCny',
] as const

export type PurchasePriceField = typeof PURCHASE_PRICE_FIELDS[number]
export type PurchasePriceComparison = Partial<Record<PurchasePriceField, number | null>>
export type ActualPurchasePrices = Pick<PurchasePriceComparison, 'actualUnitPriceCny' | 'actualShippingCny'>
export type StoredPurchasePriceComparison = PurchasePriceComparison & { baselineShippingCny?: number | null }

export const purchaseMasterPriceKeys = {
  unitPrice: '상품원가(元)',
  shipping: '배송비(元)',
} as const

export function resolvePurchasePriceComparison(
  stored: StoredPurchasePriceComparison,
  masterUnitPrice: string | null | undefined,
  masterShipping: string | null | undefined,
): Required<PurchasePriceComparison> {
  return {
    baselineUnitPriceCny: readPurchaseMasterPrice(masterUnitPrice),
    baselineUnitShippingCny: readPurchaseMasterPrice(masterShipping),
    actualUnitPriceCny: stored.actualUnitPriceCny ?? null,
    actualShippingCny: stored.actualShippingCny ?? null,
  }
}

export function readPurchasePriceComparison(rawData: Record<string, unknown>): StoredPurchasePriceComparison {
  const stored = rawData.purchasePriceComparison
  if (!stored || typeof stored !== 'object') return {}
  const source = stored as Record<string, unknown>
  const values: StoredPurchasePriceComparison = {}
  for (const field of [...PURCHASE_PRICE_FIELDS, 'baselineShippingCny'] as const) {
    const value = source[field]
    if (value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)) values[field] = value
  }
  return values
}

export function readPurchaseMasterPrice(value: string | null | undefined): number | null {
  const text = value?.trim().replace(/^(?:¥|￥)\s*|\s*元$/g, '') ?? ''
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null
  const price = Number(text.replaceAll(',', ''))
  return Number.isFinite(price) && price <= 999_999_999 ? Math.round(price * 100) / 100 : null
}

export function purchasePriceDifference(actual: number | null, baseline: number | null, fractionDigits = 2) {
  const scale = 10 ** fractionDigits
  return actual === null || baseline === null ? null : (Math.round(actual * scale) - Math.round(baseline * scale)) / scale
}

export function purchaseShippingPerUnit(shipping: number | null, quantity: number) {
  return shipping === null || quantity <= 0 ? null : shipping / quantity
}
