const DATE_KEY_PREFIX = '__priceNumberDate:'
const seoulDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' })

export function priceNumberDateKey(identifierKey: string) {
  return DATE_KEY_PREFIX + identifierKey
}

export function isPriceNumberDateKey(key: string) {
  return key.startsWith(DATE_KEY_PREFIX)
}

export function formatPriceNumberDate(date: Date) {
  return seoulDate.format(date)
}

export function getPriceNumberDate(rawData: Record<string, string>, identifierKey: string) {
  const date = rawData[priceNumberDateKey(identifierKey)]
  return /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : null
}
