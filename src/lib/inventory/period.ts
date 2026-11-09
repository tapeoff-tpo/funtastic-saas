/** A calendar month in Korea, shared by inventory search and its controls. */
export function getInventoryPeriod(year?: number | null, month?: number | null, now = new Date()) {
  const koreanNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const validYear = typeof year === 'number' && Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : koreanNow.getUTCFullYear()
  const validMonth = typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12 ? month : koreanNow.getUTCMonth() + 1
  const key = `${validYear}-${String(validMonth).padStart(2, '0')}`
  return { year: validYear, month: validMonth, key, referenceDate: new Date(`${key}-01T00:00:00+09:00`) }
}

export function inventoryPeriodDate(month: string | undefined) {
  const match = month?.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  return match ? getInventoryPeriod(Number(match[1]), Number(match[2])).referenceDate : undefined
}
