export const CNY_KRW_FALLBACK_RATE = 200

export type CnyKrwReferenceRate = {
  rate: number
  date: string | null
  source: 'latest' | 'fallback'
}

export function calculateCnyCostKrw(input: {
  chinaUnitPriceCny?: number | null
  unitShippingCny?: number | null
  exchangeRateKrw?: number | null
}) {
  const chinaUnitPriceCny = nonNegative(input.chinaUnitPriceCny)
  const unitShippingCny = nonNegative(input.unitShippingCny)
  const exchangeRateKrw = nonNegative(input.exchangeRateKrw)

  if (exchangeRateKrw <= 0 || (chinaUnitPriceCny <= 0 && unitShippingCny <= 0)) return null
  return Math.round((chinaUnitPriceCny + unitShippingCny) * exchangeRateKrw)
}

export async function getLatestCnyKrwReferenceRate(): Promise<CnyKrwReferenceRate> {
  try {
    const response = await fetch('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=KRW', {
      next: { revalidate: 60 * 60 },
    })
    if (!response.ok) throw new Error(`환율 조회 실패 (${response.status})`)

    const payload = await response.json() as { date?: unknown; rates?: { KRW?: unknown } }
    const rate = Number(payload.rates?.KRW)
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('유효한 CNY 환율이 없습니다.')

    return {
      rate: Math.round(rate * 100) / 100,
      date: typeof payload.date === 'string' ? payload.date : null,
      source: 'latest',
    }
  } catch {
    return { rate: CNY_KRW_FALLBACK_RATE, date: null, source: 'fallback' }
  }
}

function nonNegative(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0
}
