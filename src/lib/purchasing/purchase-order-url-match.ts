import { canonicalize1688OfferUrl, purchaseUrlFromMetadata, recordValue } from './purchase-url-values'

export type OrderProductLink = {
  url: string
  title?: string | null
  optionName?: string | null
  productCode?: string | null
  imageUrl?: string | null
}
export type OrderPurchaseUrlRow = {
  id: string; sku: string; productName: string; rawData: unknown
  optionName?: string | null; metadata?: unknown; orderNumber?: string | null
}

const text = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim() : ''
const productGroup = (row: OrderPurchaseUrlRow) => /^\d{6}-\d{4}$/.test(row.sku.trim())
  ? row.sku.trim().split('-')[0] : row.sku.trim()
const uniqueUrls = (links: OrderProductLink[]) => [...new Set(links.map(link => link.url))]

export function normalizeOrderProductLinks(values: OrderProductLink[]) {
  const seen = new Set<string>()
  return values.slice(0, 200).flatMap(value => {
    const url = canonicalize1688OfferUrl(value?.url)
    if (!url) return []
    const candidate: OrderProductLink = { url, title: text(value.title).slice(0, 1_000) || null }
    for (const key of ['optionName', 'productCode', 'imageUrl'] as const) {
      if (typeof value[key] === 'string' && value[key].trim()) candidate[key] = value[key].trim().slice(0, key === 'imageUrl' ? 2_000 : key === 'productCode' ? 100 : 1_000)
    }
    const key = JSON.stringify([url, text(candidate.optionName), text(candidate.productCode), text(candidate.title)])
    if (seen.has(key)) return []
    seen.add(key)
    return [candidate]
  })
}

/** Compare exact, normalized identifiers. Never assign by row position, a
 * translated guess, or a common option such as 'black' across unrelated products.
 */
export function matchOrderPurchaseUrls(rows: OrderPurchaseUrlRow[], values: OrderProductLink[]) {
  const links = normalizeOrderProductLinks(values), urls = uniqueUrls(links)
  const groups = new Set(rows.map(productGroup))
  const titlesFor = (row: OrderPurchaseUrlRow) => {
    const metadata = recordValue(row.metadata), esa = recordValue(metadata.esa009m)
    const chineseName = Object.hasOwn(metadata, 'chineseProductName') ? metadata.chineseProductName : esa['중국어 상품명']
    return new Set([text(row.productName), text(chineseName)].filter(Boolean))
  }
  return rows.flatMap(row => {
    const choose = (candidates: OrderProductLink[], method: string) => {
      let matches = candidates
      // Option text disambiguates titles shared by different offers.
      if (uniqueUrls(matches).length > 1 && text(row.optionName)) {
        const options = matches.filter(link => text(link.optionName) === text(row.optionName))
        if (options.length) matches = options
      }
      const matchesUrls = uniqueUrls(matches)
      return matchesUrls.length === 1 ? [{ requestId: row.id, url: matchesUrls[0], method }] : []
    }
    const lookup = recordValue(recordValue(row.rawData).purchaseUrlLookup)
    const storedUrl = canonicalize1688OfferUrl(lookup.resolvedUrl as string | null)
    if (lookup.matchMethod === 'manual' && (!row.orderNumber || row.orderNumber === lookup.orderNumber) && storedUrl && urls.includes(storedUrl)) {
      return [{ requestId: row.id, url: storedUrl, method: 'manual' }]
    }
    const exactCodes = links.filter(link => text(link.productCode) === text(row.sku))
    if (exactCodes.length) return choose(exactCodes, 'product_code')
    const titles = titlesFor(row)
    const sameTitle = links.filter(link => titles.has(text(link.title)))
    if (sameTitle.length) {
      // A generic Chinese name repeated for unrelated SKUs is insufficient.
      const uniqueTitleLinks = sameTitle.filter(link => {
        const titleRows = rows.filter(other => titlesFor(other).has(text(link.title)))
        if (new Set(titleRows.map(productGroup)).size === 1) return true
        if (!text(row.optionName) || text(link.optionName) !== text(row.optionName)) return false
        return new Set(titleRows.filter(other => text(other.optionName) === text(link.optionName)).map(productGroup)).size === 1
      })
      const match = choose(uniqueTitleLinks, 'product_title')
      if (match.length) return match
    }
    const previous = canonicalize1688OfferUrl(recordValue(recordValue(row.rawData).productWorkflow).purchaseUrl as string | null)
    const known = [...new Set([previous, canonicalize1688OfferUrl(purchaseUrlFromMetadata(row.metadata))].filter((url): url is string => Boolean(url && urls.includes(url))))]
    if (known.length === 1) return [{ requestId: row.id, url: known[0], method: 'saved_offer' }]
    if (urls.length === 1 && groups.size === 1) return [{ requestId: row.id, url: urls[0], method: 'single_product' }]
    return []
  })
}

export function resolveOrderPurchaseUrls(rows: OrderPurchaseUrlRow[], links: OrderProductLink[]) {
  return matchOrderPurchaseUrls(rows, links).map(({ requestId, url }) => ({ requestId, url }))
}
