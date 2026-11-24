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
