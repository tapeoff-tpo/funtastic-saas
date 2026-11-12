export const CHINA_SHIPMENT_PERIODS = [
  { value: '1m', label: '1개월', months: 1 },
  { value: '3m', label: '3개월', months: 3 },
  { value: '6m', label: '6개월', months: 6 },
  { value: '1y', label: '1년', months: 12 },
  { value: 'custom', label: '날짜 지정', months: 1 },
] as const

export type ChinaShipmentPeriod = {
  preset: (typeof CHINA_SHIPMENT_PERIODS)[number]['value']
  from: string
  to: string
  error?: string
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function resolveChinaShipmentPeriod(
  params: { period?: string; from?: string; to?: string },
  today: string,
): ChinaShipmentPeriod {
  const preset = CHINA_SHIPMENT_PERIODS.find((entry) => entry.value === params.period) ?? CHINA_SHIPMENT_PERIODS[0]
  const date = new Date(`${today}T00:00:00Z`)
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - preset.months, 1))
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate()
  start.setUTCDate(Math.min(date.getUTCDate(), lastDay))
  const from = preset.value === 'custom' ? params.from ?? start.toISOString().slice(0, 10) : start.toISOString().slice(0, 10)
  const to = preset.value === 'custom' ? params.to ?? today : today
  const range: ChinaShipmentPeriod = { preset: preset.value, from, to }
  if (!validDate(from) || !validDate(to) || from > to) range.error = '조회 시작일과 종료일을 확인해주세요.'
  return range
}

export function withChinaShipmentPeriod(href: string, currentSearch: string) {
  const url = new URL(href, 'https://shipment.local')
  if (url.pathname !== '/purchasing/china-shipments' || url.searchParams.has('period')) return href
  const current = new URLSearchParams(currentSearch)
  for (const key of ['period', 'from', 'to']) {
    const value = current.get(key)
    if (value) url.searchParams.set(key, value)
  }
  return `${url.pathname}${url.search}${url.hash}`
}
