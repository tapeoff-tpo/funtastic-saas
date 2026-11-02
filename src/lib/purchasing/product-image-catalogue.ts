const CATALOGUE_ORIGIN = 'https://funtasticb2b.com'

export type ProductImageResult = {
  sku: string
  productName: string
  imageUrls: string[]
  source: 'item-master' | 'product-management' | 'funtasticb2b' | 'none'
  sourceUrl?: string
  ambiguous?: boolean
}

export function cleanProductImageUrls(values: unknown[], origin?: string): string[] {
  const urls = values.flatMap((value) => {
    if (typeof value !== 'string' || !value.trim()) return []
    const text = value.trim()
    if (!origin && /^\/(?!\/)/.test(text)) return [text]
    try {
      const url = new URL(text, origin)
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? [url.href] : []
    } catch { return [] }
  })
  return [...new Set(urls)].slice(0, 20)
}

const normalizedName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')

/** B2B product codes and Ecount option SKUs use different namespaces. An exact,
 * unique product name must corroborate the match; never take the first search hit. */
export async function resolvePurchasingProductImages(input: {
  sku: string; productName: string; localImages: Array<{ url: string; sortOrder: number }> | null; catalogueOnly?: boolean; localSource?: 'item-master' | 'product-management'
}): Promise<ProductImageResult> {
  const local = cleanProductImageUrls([...(input.localImages ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((image) => image.url))
  const identity = { sku: input.sku, productName: input.productName }
  if (local.length && !input.catalogueOnly) return { ...identity, source: input.localSource ?? 'item-master', imageUrls: local }
  const name = input.productName.trim()
  if (!name) return { ...identity, source: 'none', imageUrls: [] }
  const url = new URL('/api/products', CATALOGUE_ORIGIN)
  url.searchParams.set(/[,\r\n]/.test(name) ? 'search' : 'exactNames', name)
  url.searchParams.set('limit', '20')
  url.searchParams.set('includeOptions', 'false')
  const response = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error('상품 이미지 연결이 지연되고 있습니다. 다시 불러오기를 눌러주세요.')
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('products' in data) || !Array.isArray(data.products)) throw new Error('상품 이미지 정보를 확인하지 못했습니다. 다시 불러오기를 눌러주세요.')
  const matches = (data.products as Array<Record<string, unknown>>).filter((product) => product && typeof product.name === 'string' && normalizedName(product.name) === normalizedName(name))
  const exactSku = matches.filter((product) => product.code === input.sku)
  const candidates = exactSku.length === 1 ? exactSku : matches
  if (candidates.length !== 1 || ('total' in data && Number(data.total) > data.products.length)) return { ...identity, source: 'none', imageUrls: [], ambiguous: candidates.length > 1 }
  const product = candidates[0]
  const imageUrls = cleanProductImageUrls([...(Array.isArray(product.thumbnailImages) ? product.thumbnailImages : []), product.imageUrl], CATALOGUE_ORIGIN)
  return { ...identity, imageUrls, source: imageUrls.length ? 'funtasticb2b' : 'none',
    ...(typeof product.code === 'string' ? { sourceUrl: `${CATALOGUE_ORIGIN}/goods/view?no=${encodeURIComponent(product.code)}` } : {}),
  }
}
