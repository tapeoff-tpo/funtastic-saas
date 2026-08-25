export type SalesPriceCalculationInput = {
  costKrw: number
  b2bPriceOverride?: number | null
  b2cPriceOverride?: number | null
  b2bFeeRate?: number
  b2cFeeRate?: number
}

export function calculateSalesPrices(input: SalesPriceCalculationInput) {
  const costKrw = positiveNumber(input.costKrw)
  if (costKrw <= 0) return null

  const b2bFeeRate = rate(input.b2bFeeRate ?? 0.1)
  const b2cFeeRate = rate(input.b2cFeeRate ?? 0.25)
  const b2bCalculated = costKrw * 1.4
  const b2bPrice = positiveNumber(input.b2bPriceOverride) || roundUpToTen(b2bCalculated * 1.1)
  const b2cCalculated = b2bPrice * 1.2
  const b2cPrice = positiveNumber(input.b2cPriceOverride) || roundUpToTen(b2cCalculated * 1.1)
  const b2bVat = b2bPrice / 11
  const b2cVat = b2cPrice / 11
  const b2bFee = b2bPrice * b2bFeeRate
  const b2cFee = b2cPrice * b2cFeeRate
  const b2bProfit = b2bPrice - costKrw - b2bVat - b2bFee
  const b2cProfit = b2cPrice - costKrw - b2cVat - b2cFee

  return {
    costKrw,
    b2bCalculated,
    b2bPrice,
    b2bVat,
    b2bFee,
    b2bProfit,
    b2bMargin: b2bProfit / b2bPrice,
    b2cCalculated,
    b2cPrice,
    b2cVat,
    b2cFee,
    b2cProfit,
    b2cMargin: b2cProfit / b2cPrice,
    b2bFeeRate,
    b2cFeeRate,
  }
}

function roundUpToTen(value: number) {
  return Math.ceil(value / 10) * 10
}

function positiveNumber(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0
}

function rate(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
