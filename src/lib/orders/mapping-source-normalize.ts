import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orderItems, orders } from '@/lib/db/schema'
import { isOrderNumberMappingCandidate } from './mapping-match'

type SourceLike = {
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId?: string | null
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
  const naverOrderIds = Array.from(new Set(
    sources
      .filter((source) =>
        source.marketplaceId === 'naver'
        && isOrderNumberMappingCandidate('naver', source.marketplaceProductId))
      .map((source) => source.marketplaceProductId.trim())
      .filter(Boolean),
  ))

  if (naverOrderIds.length === 0) return sources

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
        eq(orders.marketplaceId, 'naver'),
        inArray(orderItems.marketplaceItemId, naverOrderIds),
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
        eq(orders.marketplaceId, 'naver'),
        inArray(orders.marketplaceOrderId, naverOrderIds),
      )),
  ])

  const skuSetsByCandidate = new Map<string, Set<string>>()
  for (const row of [...itemRows, ...orderRows]) {
    const candidateId = row.candidateId?.trim()
    const sku = row.sku?.trim()
    if (!candidateId || !sku) continue
    const skuSet = skuSetsByCandidate.get(candidateId) ?? new Set<string>()
    skuSet.add(sku)
    skuSetsByCandidate.set(candidateId, skuSet)
  }

  return sources.map((source) => {
    if (
      source.marketplaceId !== 'naver'
      || !isOrderNumberMappingCandidate('naver', source.marketplaceProductId)
    ) {
      return source
    }

    const skuSet = skuSetsByCandidate.get(source.marketplaceProductId.trim())
    if (!skuSet || skuSet.size !== 1) return source

    const [sku] = [...skuSet]
    return {
      ...source,
      marketplaceProductId: sku,
    }
  })
}
