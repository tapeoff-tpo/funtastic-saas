export function canonicalize1688OfferUrl(value: string | null | undefined) {
  if (typeof value !== 'string' || !value) return null
  let decoded = value.trim()
  try { decoded = decodeURIComponent(decoded) } catch { /* Keep literal URL. */ }
  try {
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded)
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'detail.1688.com') return null
    const match = url.pathname.match(/^\/offer\/(\d{6,30})\.html\/?$/i)
    return match ? `https://detail.1688.com/offer/${match[1]}.html` : null
  } catch { return null }
}

// These 1688 surfaces identify an order, cart or buyer workspace, never a
// purchaseable offer. Share the anchored pattern with the workflow SQL update.
export const ALIBABA_ORDER_OR_CART_URL_PATTERN = '^(https?:)?//(trade|buy|cart|work)\\.1688\\.com([/?#][^\\s\\\\]*)?$'
const orderOrCartPattern = new RegExp(ALIBABA_ORDER_OR_CART_URL_PATTERN, 'i')

export function is1688OrderOrCartUrl(value: string | null | undefined) {
  if (typeof value !== 'string' || !orderOrCartPattern.test(value.trim())) return false
  try {
    const url = new URL(value.trim().startsWith('//') ? `https:${value.trim()}` : value.trim())
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && !url.port && ['trade.1688.com', 'buy.1688.com', 'cart.1688.com', 'work.1688.com'].includes(url.hostname)
  } catch { return false }
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function purchaseUrlFromMetadata(metadata: unknown) {
  const value = recordValue(recordValue(metadata).esa009m)['구매 URL']
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function metadataWithPurchaseUrl(metadata: unknown, url: string) {
  const root = { ...recordValue(metadata) }
  delete root.purchaseUrlVerification
  return { ...root, esa009m: { ...recordValue(root.esa009m), '구매 URL': url } }
}
