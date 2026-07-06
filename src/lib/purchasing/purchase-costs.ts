export type PurchaseCostInput = {
  requestedQuantity: number
  unitCostYuan: string | number | null | undefined
  unitCostKrw: string | number | null | undefined
}

export function calculatePurchaseCosts(input: PurchaseCostInput) {
  const unitCostYuan = costNumber(input.unitCostYuan)
  const unitCostKrw = costNumber(input.unitCostKrw)
  const quantity = Math.max(0, Math.trunc(input.requestedQuantity))

  return {
    unitCostYuan,
    unitCostKrw,
    totalCostYuan: unitCostYuan === null ? null : unitCostYuan * quantity,
    totalCostKrw: unitCostKrw === null ? null : unitCostKrw * quantity,
  }
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
    : Number(value.replaceAll(',', '').trim())
  return Number.isFinite(number) ? number : null
}
