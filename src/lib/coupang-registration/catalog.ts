import { and, eq, ilike, ne, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { inventory, products } from '@/lib/db/schema'
import { isImageUrl, money, type CatalogProduct } from './model'

type SourceProduct = {
  code: string; name: string; price?: number; status?: string; imageUrl?: string; thumbnailImages?: string[]; detailImages?: string[]; description?: string;
  options?: Array<{ optionName?: string; addPrice?: number }>; productInfoNotice?: Array<{ label: string; value: string }>
}
const SOURCE = 'https://funtasticb2b.com'

async function sourceJson(path: string): Promise<unknown> {
  const response = await fetch(`${SOURCE}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000), redirect: 'error' })
  if (!response.ok) throw new Error(`B2B 상품을 가져오지 못했습니다. (${response.status})`)
  return response.json()
}

export async function findCostCandidates(userId: string, search: string, sourceNames: string[] = []) {
  const patterns = sourceNames.length ? sourceNames.slice(0, 100) : [search]
  if (!patterns.some(Boolean)) return []
  return db.select({
    sku: products.internalSku, name: products.name, costPrice: products.costPrice,
    optionName: sql<string>`COALESCE(MAX(${inventory.optionName}), '')`,
  }).from(products).leftJoin(inventory, and(eq(inventory.sku, products.internalSku), eq(inventory.userId, userId)))
    .where(and(eq(products.userId, userId), ne(products.status, 'deleted'), or(...patterns.flatMap((pattern) => [ilike(products.name, `%${pattern}%`), ilike(products.internalSku, `%${pattern}%`), ilike(inventory.productName, `%${pattern}%`)]))))
    .groupBy(products.id).limit(500)
}

async function normalizeCatalog(userId: string, sources: SourceProduct[]): Promise<CatalogProduct[]> {
  const unique = [...new Map(sources.map((product) => [product.code, product])).values()]
  const candidates = unique.length ? await findCostCandidates(userId, '', unique.map((product) => product.name)) : []
  return unique.map((product) => {
    const htmlUrls = Array.from((product.description ?? '').matchAll(/<img[^>]+src=["']([^"']+)["']/gi), (match) => match[1].replaceAll('&amp;', '&'))
    const remote = htmlUrls.filter(isImageUrl)
    const details = (product.detailImages ?? []).filter(isImageUrl)
    return {
      code: String(product.code), name: product.name, price: money(product.price), status: product.status ?? '',
      thumbnails: [...new Set([...(product.thumbnailImages ?? []), product.imageUrl ?? ''].filter(isImageUrl))],
      detailImages: [...new Set(remote.length ? remote : details)],
      options: (product.options ?? []).map((option) => ({ name: option.optionName || '기본', addPrice: money(option.addPrice) ?? 0 })),
      notice: (product.productInfoNotice ?? []).filter((item) => item.label),
      costCandidates: candidates.filter((item) => item.name.includes(product.name)).map((item) => ({ ...item, costPrice: money(item.costPrice) })),
    }
  })
}

export async function searchCatalog(userId: string, query: string) {
  if (!query.trim()) return []
  const payload = await sourceJson(`/api/products?${new URLSearchParams({ search: query, limit: '24' })}`) as { products?: SourceProduct[] }
  // The detail endpoint includes option surcharges; list responses may omit them.
  const detailed: SourceProduct[] = []
  const sourceRows = payload.products ?? []
  for (let index = 0; index < sourceRows.length; index += 4) {
    detailed.push(...await Promise.all(sourceRows.slice(index, index + 4).map((product) => sourceJson(`/api/products/by-code?${new URLSearchParams({ code: product.code })}`) as Promise<SourceProduct>)))
  }
  return normalizeCatalog(userId, detailed)
}

export async function matchCatalogProducts(userId: string, names: string[], codes: string[]) {
  const candidates = new Set<string>()
  for (const name of names) {
    const parts = name.trim().split(/\s+/)
    for (let count = parts.length; count >= Math.min(2, parts.length); count--) candidates.add(parts.slice(0, count).join(' '))
  }
  const found: SourceProduct[] = []
  const chunks = [...candidates]
  for (let index = 0; index < chunks.length; index += 100) {
    const response = await sourceJson(`/api/products?${new URLSearchParams({ exactNames: chunks.slice(index, index + 100).join('\n'), limit: '100' })}`) as { products?: SourceProduct[] }
    found.push(...(response.products ?? []))
  }
  for (const code of [...new Set(codes)].filter(Boolean)) {
    if (!found.some((product) => product.code === code)) found.push(await sourceJson(`/api/products/by-code?${new URLSearchParams({ code })}`) as SourceProduct)
  }
  const full: SourceProduct[] = []
  const unique = [...new Map(found.map((product) => [product.code, product])).values()]
  for (let index = 0; index < unique.length; index += 4) full.push(...await Promise.all(unique.slice(index, index + 4).map((product) => sourceJson(`/api/products/by-code?${new URLSearchParams({ code: product.code })}`) as Promise<SourceProduct>)))
  return normalizeCatalog(userId, full)
}
