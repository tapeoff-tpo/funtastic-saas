import { and, eq, ilike, ne, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { inventory, products } from '@/lib/db/schema'
import { isImageUrl, money, type CatalogProduct } from './model'
import { itemNewCost } from './item-cost'

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
  const rows = await db.select({
    sku: products.internalSku,
    name: sql<string>`COALESCE(NULLIF(${products.metadata}->'esa009m'->>'품목명', ''), ${products.name})`,
    metadata: products.metadata,
    optionName: sql<string>`COALESCE(NULLIF(${products.metadata}->'esa009m'->>'규격정보', ''), MAX(${inventory.optionName}), '')`,
  }).from(products).leftJoin(inventory, and(eq(inventory.sku, products.internalSku), eq(inventory.userId, userId)))
    .where(and(eq(products.userId, userId), ne(products.status, 'deleted'), or(...patterns.flatMap((pattern) => [ilike(products.name, `%${pattern}%`), ilike(products.internalSku, `%${pattern}%`), ilike(inventory.productName, `%${pattern}%`), sql`${products.metadata}->'esa009m'->>'품목명' ILIKE ${`%${pattern}%`}`]))))
    .groupBy(products.id).limit(500)
  return rows.map(({ metadata, ...row }) => ({ ...row, costPrice: itemNewCost(metadata) }))
}

async function normalizeCatalog(userId: string, sources: SourceProduct[], includeCosts = true): Promise<CatalogProduct[]> {
  const unique = [...new Map(sources.map((product) => [product.code, product])).values()]
  const candidates = includeCosts && unique.length ? await findCostCandidates(userId, '', unique.map((product) => product.name)) : []
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
  // Show results after one list request. Hydrate option surcharges and current
  // item-master costs only when a product is selected for registration.
  return normalizeCatalog(userId, payload.products ?? [], false)
}

export async function getCatalogProduct(userId: string, code: string) {
  const product = await sourceJson(`/api/products/by-code?${new URLSearchParams({ code })}`) as SourceProduct
  return (await normalizeCatalog(userId, [product]))[0]
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
