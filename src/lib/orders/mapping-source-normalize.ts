import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orderItems, orders } from '@/lib/db/schema'
import { usesSkuMappingKey } from './mapping-key-marketplaces'

type SourceLike = {
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId?: string | null
}

type SkuNormalizedMarketplace = string

function isSkuNormalizedMarketplace(marketplaceId: string): marketplaceId is SkuNormalizedMarketplace {
  return usesSkuMappingKey(marketplaceId)
}

/**
 * Some marketplaces expose order-line ids in order_items.marketplace_item_id.
 * Those ids are valid for order actions, but must not become reusable product
 * mapping keys. When a stable seller SKU exists, normalize stale client
 * payloads server-side before the blocklist validation runs.
 */
export async function normalizeMappingSources<T extends SourceLike>(
  userId: string,
  sources: T[],
): Promise<T[]> {
  const candidateIdsByMarketplace = new Map<SkuNormalizedMarketplace, Set<string>>()
  for (const source of sources) {
    if (!isSkuNormalizedMarketplace(source.marketplaceId)) continue
    const productId = source.marketplaceProductId.trim()
    const optionId = source.marketplaceOptionId?.trim()
    if (!productId) continue

    const ids = candidateIdsByMarketplace.get(source.marketplaceId) ?? new Set<string>()
    ids.add(productId)
    candidateIdsByMarketplace.set(source.marketplaceId, ids)

    const fullItemId = optionId ? `${productId}-${optionId}` : productId
    if (fullItemId !== productId) {
      ids.add(fullItemId)
    }
  }

  const lookupPairs = [...candidateIdsByMarketplace.entries()].flatMap(([marketplaceId, ids]) =>
    [...ids].map((candidateId) => ({ marketplaceId, candidateId })),
  )

  if (lookupPairs.length === 0) return sources

  const skuSetsByMarketCandidate = new Map<string, Set<string>>()
  for (const [marketplaceId, ids] of candidateIdsByMarketplace.entries()) {
    const candidateIds = [...ids]
    if (candidateIds.length === 0) continue

    const [itemRows, orderRows] = await Promise.all([
      db
        .select({
          candidateId: orderItems.marketplaceItemId,
          sku: orderItems.sku,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(and(
          eq(orders.userId, userId),
          eq(orders.marketplaceId, marketplaceId),
          inArray(orderItems.marketplaceItemId, candidateIds),
        )),
      db
        .select({
          candidateId: orders.marketplaceOrderId,
          sku: orderItems.sku,
        })
        .from(orders)
        .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(and(
          eq(orders.userId, userId),
          eq(orders.marketplaceId, marketplaceId),
          inArray(orders.marketplaceOrderId, candidateIds),
        )),
    ])

    for (const row of [...itemRows, ...orderRows]) {
      const candidateId = row.candidateId?.trim()
      const sku = row.sku?.trim()
      if (!candidateId || !sku) continue
      const key = `${marketplaceId}:${candidateId}`
      const skuSet = skuSetsByMarketCandidate.get(key) ?? new Set<string>()
      skuSet.add(sku)
      skuSetsByMarketCandidate.set(key, skuSet)
    }
  }

  return sources.map((source) => {
    if (!isSkuNormalizedMarketplace(source.marketplaceId)) return source

    const productId = source.marketplaceProductId.trim()
    const optionId = source.marketplaceOptionId?.trim()
    const candidateIds = [
      optionId ? `${productId}-${optionId}` : null,
      productId,
    ].filter((candidateId): candidateId is string => Boolean(candidateId))

    for (const candidateId of candidateIds) {
      const skuSet = skuSetsByMarketCandidate.get(`${source.marketplaceId}:${candidateId}`)
      if (!skuSet || skuSet.size !== 1) continue

      const [sku] = [...skuSet]
      return {
        ...source,
        marketplaceProductId: sku,
        marketplaceOptionId: candidateId === productId ? source.marketplaceOptionId : '',
      }
    }

    return source
  })
}
