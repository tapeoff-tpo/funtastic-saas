export type NewProductOptionDetail = {
  id: string
  optionName: string | null
  sabangnetOptionCode: string | null
  sabangnetRegistered: 'Y' | 'N' | null
  chinaUnitPriceCny: number | null
  unitShippingCny: number | null
  productSize: string | null
  bulkSize: string | null
  purchaseReferenceNotes: string | null
  costKrw: number | null
  previousCostKrw: number | null
  exchangeRateKrw: number | null
  b2bPrice: number | null
  b2cPrice: number | null
}

const MAX_OPTION_ROWS = 200

export function normalizeNewProductOptionDetails(value: unknown): NewProductOptionDetail[] {
  if (!Array.isArray(value)) return []

  const usedIds = new Set<string>()
  return value.slice(0, MAX_OPTION_ROWS).map((entry, index) => {
    const row = asRecord(entry)
    const registered = text(row.sabangnetRegistered).trim().toUpperCase()
    const requestedId = nullableText(row.id, 100)
    const id = requestedId && !usedIds.has(requestedId)
      ? requestedId
      : nextOptionId(index, usedIds)
    usedIds.add(id)
    return {
      id,
      optionName: nullableText(row.optionName, 500),
      sabangnetOptionCode: nullableText(row.sabangnetOptionCode, 100),
      sabangnetRegistered: registered === 'Y' ? 'Y' : registered === 'N' ? 'N' : null,
      chinaUnitPriceCny: nullableNumber(row.chinaUnitPriceCny),
      unitShippingCny: nullableNumber(row.unitShippingCny),
      productSize: nullableText(row.productSize, 1_000),
      bulkSize: nullableText(row.bulkSize, 1_000),
      purchaseReferenceNotes: nullableText(row.purchaseReferenceNotes),
      costKrw: nullableInteger(row.costKrw),
      previousCostKrw: nullableInteger(row.previousCostKrw),
      exchangeRateKrw: nullableNumber(row.exchangeRateKrw),
      b2bPrice: nullableInteger(row.b2bPrice),
      b2cPrice: nullableInteger(row.b2cPrice),
    }
  })
}

function nextOptionId(index: number, usedIds: Set<string>) {
  const base = `option-${index + 1}`
  if (!usedIds.has(base)) return base
  let suffix = 2
  while (usedIds.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function nullableText(value: unknown, maxLength = 20_000) {
  const normalized = text(value).trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function nullableNumber(value: unknown) {
  const normalized = text(value).replace(/,/g, '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function nullableInteger(value: unknown) {
  const parsed = nullableNumber(value)
  return parsed == null ? null : Math.round(parsed)
}
