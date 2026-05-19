import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { mappingSources, orderItems, orders } from '@/lib/db/schema'
import { buildMappingIndex, lookupMappingRef, EXACT_OPTION_ID } from '@/lib/orders/mapping-match'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { and, eq, inArray } from 'drizzle-orm'
import { logOrderChanges } from '@/lib/orders/change-log'

type MappingSourceRow = {
  id: string
  mappingCodeId: string
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId: string
}

function candidateSourceKeys(marketplaceItemId: string, optionText: string | null): Set<string> {
  const keys = new Set<string>()
  const trimmedOption = optionText?.trim().slice(0, 100)

  keys.add(`${marketplaceItemId}|`)
  if (trimmedOption) {
    keys.add(`${marketplaceItemId}|${trimmedOption}`)
  } else {
    keys.add(`${marketplaceItemId}|${EXACT_OPTION_ID}`)
  }

  const separatorIndex = marketplaceItemId.indexOf('-')
  if (separatorIndex > 0) {
    const productId = marketplaceItemId.slice(0, separatorIndex)
    const optionId = marketplaceItemId.slice(separatorIndex + 1)
    keys.add(`${productId}|`)
    keys.add(`${productId}|${optionId}`)
  }

  return keys
}

function findMatchedSourceIds(
  sources: MappingSourceRow[],
  marketplaceId: string,
  marketplaceItemId: string,
  optionText: string | null,
): string[] {
  const index = buildMappingIndex(
    sources.map((source) => ({
      marketplaceId: source.marketplaceId,
      marketplaceProductId: source.marketplaceProductId,
      marketplaceOptionId: source.marketplaceOptionId,
      ref: source.mappingCodeId,
    })),
  )
  const mappingCodeId = lookupMappingRef(index, marketplaceId, marketplaceItemId, optionText)
  if (!mappingCodeId) return []

  const keys = candidateSourceKeys(marketplaceItemId, optionText)
  return sources
    .filter((source) => {
      if (source.mappingCodeId !== mappingCodeId) return false
      if (source.marketplaceId !== marketplaceId) return false
      return keys.has(`${source.marketplaceProductId}|${source.marketplaceOptionId}`)
    })
    .map((source) => source.id)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: { orderIds?: string[] }
  try {
    body = await req.json() as { orderIds?: string[] }
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const requestedIds = Array.isArray(body.orderIds)
    ? body.orderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  if (requestedIds.length === 0) {
    return NextResponse.json({ error: 'orderIds must be a non-empty array' }, { status: 400 })
  }

  const orderRows = await db
    .select({
      id: orders.id,
      marketplaceId: orders.marketplaceId,
    })
    .from(orders)
    .where(and(eq(orders.userId, workspaceUserId), inArray(orders.id, requestedIds)))

  const orderIds = orderRows.map((order) => order.id)
  if (orderIds.length === 0) {
    return NextResponse.json({ unmappedOrders: 0, removedSources: 0, clearedItems: 0 })
  }

  const [items, sources] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        marketplaceItemId: orderItems.marketplaceItemId,
        optionText: orderItems.optionText,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds)),
    db
      .select({
        id: mappingSources.id,
        mappingCodeId: mappingSources.mappingCodeId,
        marketplaceId: mappingSources.marketplaceId,
        marketplaceProductId: mappingSources.marketplaceProductId,
        marketplaceOptionId: mappingSources.marketplaceOptionId,
      })
      .from(mappingSources)
      .where(eq(mappingSources.userId, workspaceUserId)),
  ])

  const marketplaceByOrderId = new Map(orderRows.map((order) => [order.id, order.marketplaceId]))
  const sourceIds = new Set<string>()

  for (const item of items) {
    if (!item.marketplaceItemId) continue
    const marketplaceId = marketplaceByOrderId.get(item.orderId)
    if (!marketplaceId) continue
    for (const sourceId of findMatchedSourceIds(sources, marketplaceId, item.marketplaceItemId, item.optionText)) {
      sourceIds.add(sourceId)
    }
  }

  const result = await db.transaction(async (tx) => {
    const clearedItems = await tx
      .update(orderItems)
      .set({
        sku: null,
        skuMultiplier: 1,
        fulfillmentCode: 'normal',
      })
      .where(inArray(orderItems.orderId, orderIds))
      .returning({ id: orderItems.id })

    let removedSources = 0
    const sourceIdList = [...sourceIds]
    if (sourceIdList.length > 0) {
      const deleted = await tx
        .delete(mappingSources)
        .where(and(eq(mappingSources.userId, workspaceUserId), inArray(mappingSources.id, sourceIdList)))
        .returning({ id: mappingSources.id })
      removedSources = deleted.length
    }

    const unmappedOrders = await tx
      .update(orders)
      .set({
        mappedAt: null,
        mappedByUserId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.userId, workspaceUserId), inArray(orders.id, orderIds)))
      .returning({ id: orders.id })

    await logOrderChanges(unmappedOrders.map((order) => ({
      orderId: order.id,
      userId: workspaceUserId,
      actorId: user.id,
      action: 'mapping.removed',
      title: '매핑해제',
      description: '주문 매핑이 해제되었습니다.',
      after: { mappedAt: null },
      metadata: { clearedItems: clearedItems.length, removedSources },
    })), tx)

    return {
      clearedItems: clearedItems.length,
      removedSources,
      unmappedOrders: unmappedOrders.length,
    }
  })

  revalidateTag('product-mappings', 'max')
  revalidateTag('orders', 'max')
  revalidatePath('/orders')

  return NextResponse.json(result)
}
