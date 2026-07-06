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

function costNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number'
    ? value
    : Number(value.replaceAll(',', '').trim())
  return Number.isFinite(number) ? number : null
}
