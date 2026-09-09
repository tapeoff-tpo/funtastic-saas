export type PurchaseCostInput = {
  requestedQuantity: number
  unitCostYuan?: string | number | null | undefined
  unitCostKrw?: string | number | null | undefined
  specialPriceCny?: string | number | null | undefined
  newCostCny?: string | number | null | undefined
  exchangeRateKrw?: string | number | null | undefined
}

export const PURCHASE_CNY_RATE_MARKUP = 0.05

export function calculatePurchaseCosts(input: PurchaseCostInput) {
  const unitCostYuan = resolvePurchaseUnitCostYuan(input)
  const exchangeRateKrw = costNumber(input.exchangeRateKrw)
  const appliedExchangeRateKrw = calculateAppliedPurchaseExchangeRateKrw(exchangeRateKrw)
  const legacyUnitCostKrw = costNumber(input.unitCostKrw)
  const unitCostKrw = unitCostYuan !== null && appliedExchangeRateKrw !== null
    ? Math.round(unitCostYuan * appliedExchangeRateKrw)
    : legacyUnitCostKrw
  const quantity = Math.max(0, Math.trunc(input.requestedQuantity))

  return {
    unitCostYuan,
    unitCostKrw,
    totalCostYuan: unitCostYuan === null ? null : unitCostYuan * quantity,
    totalCostKrw: unitCostYuan !== null && appliedExchangeRateKrw !== null
      ? Math.round(unitCostYuan * quantity * appliedExchangeRateKrw)
      : unitCostKrw === null ? null : unitCostKrw * quantity,
  }
}

export function resolvePurchaseUnitCostYuan(input: Pick<PurchaseCostInput, 'specialPriceCny' | 'newCostCny' | 'unitCostYuan'>) {
  return positiveCostNumber(input.specialPriceCny)
    ?? positiveCostNumber(input.newCostCny)
    ?? costNumber(input.unitCostYuan)
}

export function calculateAppliedPurchaseExchangeRateKrw(value: string | number | null | undefined) {
  const exchangeRateKrw = costNumber(value)
  if (exchangeRateKrw === null || exchangeRateKrw <= 0) return null
  return Math.round(exchangeRateKrw * (1 + PURCHASE_CNY_RATE_MARKUP) * 10_000) / 10_000
}

export function sumPurchaseCosts(inputs: PurchaseCostInput[]) {
  const totals = inputs.reduce((result, input) => {
    const costs = calculatePurchaseCosts(input)
    if (costs.totalCostYuan === null) result.missingYuanCostCount += 1
    else result.totalCostYuan += costs.totalCostYuan
    if (costs.totalCostKrw === null) result.missingKrwCostCount += 1
    else result.totalCostKrw += costs.totalCostKrw
    return result
  }, {
    totalCostYuan: 0,
    totalCostKrw: 0,
    missingYuanCostCount: 0,
    missingKrwCostCount: 0,
  })
  return {
    ...totals,
    totalCostYuan: Math.round(totals.totalCostYuan * 100) / 100,
    totalCostKrw: Math.round(totals.totalCostKrw),
  }
}

function costNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number'
    ? value
    : Number(value.replace(/[^0-9.-]/g, '').trim())
  return Number.isFinite(number) ? number : null
}

function positiveCostNumber(value: string | number | null | undefined) {
  const number = costNumber(value)
  return number !== null && number > 0 ? number : null
}
