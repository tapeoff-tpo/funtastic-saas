export const COMMON_PRICE_KEY = '공통 판매가'
export const REGISTRATION_EDIT_PREFIX = '__registrationEdit:'

export function registrationPriceKey(mallId: string) {
  return REGISTRATION_EDIT_PREFIX + 'price:' + mallId
}

export function registrationNumberKey(mallId: string) {
  return REGISTRATION_EDIT_PREFIX + 'number:' + mallId
}

export function registrationShippingKey(mallId: string) {
  return REGISTRATION_EDIT_PREFIX + 'shipping:' + mallId
}

export function priceAmount(value: unknown) {
  const normalized = String(value ?? '').trim().replace(/,/g, '')
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

export function getCommonPrice(raw: Record<string, unknown>) {
  const common = priceAmount(raw[COMMON_PRICE_KEY])
  const b2b = priceAmount(raw['B2B 판매가'])
  const b2c = priceAmount(raw['B2C 판매가'])
  if (common !== null) return common
  return b2b !== null && b2c !== null && b2b !== b2c ? null : b2b ?? b2c
}

export function getRegistrationMargin(raw: Record<string, unknown>, mallId: string, fee: number | undefined) {
  const common = getCommonPrice(raw)
  const override = priceAmount(raw[registrationPriceKey(mallId)])
  const price = override ?? common
  const cost = priceAmount(raw['원가']) ?? priceAmount(raw['0.3 원가'])
  const shipping = priceAmount(raw[registrationShippingKey(mallId)])
  const subtotal = price !== null && cost !== null && fee !== undefined
    ? Math.round(price * (1 - fee / 100) - cost)
    : null
  return { price, override, cost, shipping, margin: subtotal === null ? null : subtotal - (shipping ?? 0) }
}

export function marketplaceFeeId(mallId: string) {
  const id = mallId.replace(/^new-/, '')
  if (id.startsWith('smartstore-')) return 'smartstore'
  if (id === 'ohouse-home') return 'ohouse'
  if (id === 'kakao-life' || id === 'kakao-funta') return 'kakao-store'
  if (id === 'banana') return 'banana-b2b'
  if (id === 'funtab2b') return 'funtastic-b2b'
  return id
}

const B2B_MARKETPLACES = new Set([
  'domeme', 'domemae', 'onchannel', 'firstmall', 'funtab2b', 'ownerclan', 'domechango',
  'wtrading', 'domesin', 'funn', 'tobizon', 'specialoffer', 'banana',
])

export function getMallBasePrice(raw: Record<string, unknown>, mallId: string, sourceKey: string) {
  const key = B2B_MARKETPLACES.has(mallId.replace(/^new-/, '')) ? 'B2B' : 'B2C'
  return priceAmount(raw[`__product${key}Price`])
    ?? priceAmount(raw[sourceKey])
    ?? priceAmount(raw[`${key} 판매가`])
    ?? getCommonPrice(raw)
}


export function registrationIdentifiersKey(mallId: string) {
  return REGISTRATION_EDIT_PREFIX + 'identifiers:' + mallId
}

export function registrationNumberActorKey(mallId: string, identifierKey: string) {
  return REGISTRATION_EDIT_PREFIX + 'numberActor:' + mallId + ':' + identifierKey
}
