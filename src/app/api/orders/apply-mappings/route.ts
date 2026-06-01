/**
 * POST /api/orders/apply-mappings
 *
 * 선택된 주문(orderIds)들을 "매핑완료" 상태로 마크.
 * - orders.mapped_at = now()
 * - orders.mapped_by_user_id = current user
 *
 * 사방넷 워크플로우의 "매핑완료처리" 에 해당. 별도 status 변경은 없고
 * 단지 mapped_at 만 기록한다 (status='new' 그대로 유지). 이 시점은 추후
 * 출고준비(preparing) 전환 / 발주확인 시 사용된다.
 *
 * Body: { orderIds: string[] }
 * Returns: { applied: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { inventory, mappingCodes, mappingComponents, mappingSources, orderItems, orders, products, productVariants } from '@/lib/db/schema'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { logOrderChanges } from '@/lib/orders/change-log'
import { getRawMappingCandidateIdsForItem, isIgnoredMappingCandidate, lookupCompatibleMappingRef, type MappingSource } from '@/lib/orders/mapping-match'
import { lockOrderItemsForOrders } from '@/lib/orders/locking'

type ValidationFailure = {
  orderId: string
  marketplaceOrderId: string
  reason: string
}

type MappingAlias = {
  mappingCodeId: string
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId: string
  productNameSnapshot: string | null
  optionNameSnapshot: string | null
}

type HistoricalAliasRow = Pick<MappingAlias, 'mappingCodeId' | 'marketplaceId' | 'marketplaceProductId' | 'marketplaceOptionId'>

type ItemMappingLookupResult = {
  mappingCodeId: string | null
  failureReason?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function textValue(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

function mappingFailureTarget(item: {
  marketplaceId: string
  marketplaceItemId: string | null
  sku: string | null
  productName: string
  optionText: string | null
  rawData: unknown
  itemId: string
}, candidateIds: string[]): string {
  const raw = asRecord(item.rawData)
  if (item.marketplaceId === 'cjonestyle') {
    const productId = textValue(raw?.vendorItemCode) ?? textValue(raw?.itemCode)
    const option = item.optionText?.trim() || textValue(raw?.optionName) || textValue(raw?.optionCode)
    if (productId) return `CJ 상품코드 ${productId}${option ? ` / 옵션 ${option}` : ''}`
  }

  const reusableCandidate = candidateIds.find((candidateId) => !isIgnoredMappingCandidate(item.marketplaceId, candidateId))
  const directSku = item.sku && !isIgnoredMappingCandidate(item.marketplaceId, item.sku) ? item.sku : null
  return directSku ?? reusableCandidate ?? item.productName ?? item.itemId
}

async function validateOrdersHaveInternalMappings(
  userId: string,
  orderIds: string[],
): Promise<{ validOrderIds: string[]; failures: ValidationFailure[]; aliases: MappingAlias[] }> {
  const targetRows = await db
    .select({
      orderId: orders.id,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
      itemId: orderItems.id,
      marketplaceItemId: orderItems.marketplaceItemId,
      sku: orderItems.sku,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      rawData: orders.rawData,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.userId, userId), inArray(orders.id, orderIds)))

  const orderNoById = new Map<string, string>()
  const rowsByOrderId = new Map<string, typeof targetRows>()
  for (const row of targetRows) {
    orderNoById.set(row.orderId, row.marketplaceOrderId)
    const list = rowsByOrderId.get(row.orderId) ?? []
    list.push(row)
    rowsByOrderId.set(row.orderId, list)
  }

  const [productRows, variantRows, inventoryRows, sourceRows, componentRows, historicalAliasResult] = await Promise.all([
    db
      .select({ sku: products.internalSku })
      .from(products)
      .where(eq(products.userId, userId)),
    db
      .select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(products.userId, userId)),
    db
      .select({ sku: inventory.sku })
      .from(inventory)
      .where(eq(inventory.userId, userId)),
    db
      .select({
        mappingCodeId: mappingSources.mappingCodeId,
        marketplaceId: mappingSources.marketplaceId,
        marketplaceProductId: mappingSources.marketplaceProductId,
        marketplaceOptionId: mappingSources.marketplaceOptionId,
        productNameSnapshot: mappingSources.productNameSnapshot,
        optionNameSnapshot: mappingSources.optionNameSnapshot,
      })
      .from(mappingSources)
      .innerJoin(mappingCodes, eq(mappingCodes.id, mappingSources.mappingCodeId))
      .where(and(eq(mappingSources.userId, userId), eq(mappingCodes.isActive, true))),
    db
      .select({
        mappingCodeId: mappingComponents.mappingCodeId,
        sku: mappingComponents.sku,
      })
      .from(mappingComponents)
      .innerJoin(mappingCodes, eq(mappingCodes.id, mappingComponents.mappingCodeId))
      .where(and(eq(mappingComponents.userId, userId), eq(mappingCodes.isActive, true))),
    db.execute<HistoricalAliasRow>(sql`
      SELECT DISTINCT
        ms.mapping_code_id AS "mappingCodeId",
        ms.marketplace_id AS "marketplaceId",
        oi.sku AS "marketplaceProductId",
        ms.marketplace_option_id AS "marketplaceOptionId"
      FROM mapping_sources ms
      INNER JOIN mapping_codes mc ON mc.id = ms.mapping_code_id AND mc.user_id = ms.user_id AND mc.is_active = TRUE
      INNER JOIN order_items oi ON oi.marketplace_item_id = ms.marketplace_product_id
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE ms.user_id = ${userId}
        AND ms.marketplace_id = 'funtastic-b2b'
        AND o.user_id = ms.user_id
        AND o.marketplace_id = ms.marketplace_id
        AND NULLIF(oi.sku, '') IS NOT NULL
    `),
  ])
  const historicalAliasRows = Array.isArray(historicalAliasResult)
    ? historicalAliasResult as HistoricalAliasRow[]
    : (historicalAliasResult as unknown as { rows?: HistoricalAliasRow[] }).rows ?? []

  const validSkus = new Set<string>()
  for (const row of productRows) validSkus.add(row.sku.trim())
  for (const row of variantRows) validSkus.add(row.sku.trim())
  for (const row of inventoryRows) validSkus.add(row.sku.trim())

  const mappingSourcesForLookup = (
    [...sourceRows, ...historicalAliasRows].map<MappingSource>((row) => ({
      marketplaceId: row.marketplaceId,
      marketplaceProductId: row.marketplaceProductId,
      marketplaceOptionId: row.marketplaceOptionId,
      productNameSnapshot: 'productNameSnapshot' in row ? row.productNameSnapshot : null,
      optionNameSnapshot: 'optionNameSnapshot' in row ? row.optionNameSnapshot : null,
      ref: row.mappingCodeId,
    }))
  )

  const componentsByCode = new Map<string, string[]>()
  for (const row of componentRows) {
    const list = componentsByCode.get(row.mappingCodeId) ?? []
    list.push(row.sku.trim())
    componentsByCode.set(row.mappingCodeId, list)
  }

  const findItemMappingCode = (item: typeof targetRows[number]): ItemMappingLookupResult => {
    const candidateIds = Array.from(new Set(
      [item.marketplaceItemId, item.sku, ...getRawMappingCandidateIdsForItem(item.rawData, item.marketplaceItemId)]
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ))
    const reusableCandidateIds = candidateIds.filter((candidateId) => !isIgnoredMappingCandidate(item.marketplaceId, candidateId))
    const failureTarget = mappingFailureTarget(item, reusableCandidateIds)
    const directSku = reusableCandidateIds.find((candidateId) => validSkus.has(candidateId))
    if (directSku) return { mappingCodeId: '__direct_sku__' }

    const mappingCodeId = lookupCompatibleMappingRef(
      mappingSourcesForLookup,
      item.marketplaceId,
      reusableCandidateIds,
      item.optionText,
      item.productName,
    )
    if (!mappingCodeId) {
      return {
        mappingCodeId: null,
        failureReason: `내부 상품코드 매핑 실패: ${failureTarget}`,
      }
    }

    const componentSkus = componentsByCode.get(mappingCodeId) ?? []
    if (componentSkus.length === 0) {
      return {
        mappingCodeId: null,
        failureReason: `매핑 구성상품이 비어있음: ${failureTarget}`,
      }
    }

    const invalidComponentSkus = componentSkus.filter((sku) => !validSkus.has(sku))
    if (invalidComponentSkus.length > 0) {
      return {
        mappingCodeId: null,
        failureReason: `매핑된 내부 상품코드가 상품/재고에 없음: ${invalidComponentSkus.join(', ')}`,
      }
    }

    return { mappingCodeId }
  }

  const validOrderIds: string[] = []
  const failures: ValidationFailure[] = []
  const aliasesByKey = new Map<string, MappingAlias>()

  for (const orderId of orderIds) {
    const items = rowsByOrderId.get(orderId) ?? []
    const marketplaceOrderId = orderNoById.get(orderId) ?? orderId
    if (items.length === 0) {
      failures.push({ orderId, marketplaceOrderId, reason: '주문 품목이 없습니다.' })
      continue
    }

    const itemMatches = items.map((item) => ({ item, ...findItemMappingCode(item) }))
    const failedMatch = itemMatches.find((match) => !match.mappingCodeId)
    if (failedMatch) {
      if (failedMatch.failureReason) {
        failures.push({ orderId, marketplaceOrderId, reason: failedMatch.failureReason })
        continue
      }
      const failedItem = failedMatch.item
      failures.push({
        orderId,
        marketplaceOrderId,
        reason: `내부 상품코드 매핑 실패: ${failedItem.sku || failedItem.marketplaceItemId || failedItem.itemId}`,
      })
      continue
    }

    for (const { item, mappingCodeId } of itemMatches) {
      const stableProductId = item.sku?.trim()
      if (item.marketplaceId !== 'funtastic-b2b' || !stableProductId || !mappingCodeId || mappingCodeId === '__direct_sku__') {
        continue
      }
      const stableOptionId = item.optionText?.trim().slice(0, 100) || '__exact__'
      const key = `${item.marketplaceId}:${stableProductId}:${stableOptionId}`
      aliasesByKey.set(key, {
        mappingCodeId,
        marketplaceId: item.marketplaceId,
        marketplaceProductId: stableProductId,
        marketplaceOptionId: stableOptionId,
        productNameSnapshot: item.productName,
        optionNameSnapshot: item.optionText,
      })
    }
    validOrderIds.push(orderId)
  }

  return { validOrderIds, failures, aliases: [...aliasesByKey.values()] }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: { orderIds?: string[] }
  try {
    body = await req.json() as { orderIds?: string[] }
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const orderIds = Array.isArray(body.orderIds)
    ? body.orderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  if (orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds must be a non-empty array' }, { status: 400 })
  }

  const { validOrderIds, failures, aliases } = await validateOrdersHaveInternalMappings(workspaceUserId, orderIds)

  if (validOrderIds.length === 0) {
    return NextResponse.json({
      applied: 0,
      failed: failures.length,
      failures,
      error: failures[0]?.reason ?? '내부 상품코드로 매핑된 주문이 없습니다.',
    }, { status: 409 })
  }

  let result: Array<{ id: string; mappedAt: Date | null }>
  try {
    result = await db.transaction(async (tx) => {
      if (aliases.length > 0) {
        await tx
          .insert(mappingSources)
          .values(aliases.map((alias) => ({
            ...alias,
            userId: workspaceUserId,
          })))
          .onConflictDoNothing()
      }

      await lockOrderItemsForOrders(tx, workspaceUserId, validOrderIds, user.id)

      const unresolvedItems = await tx
        .select({ itemId: orderItems.id })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(and(
          eq(orders.userId, workspaceUserId),
          inArray(orderItems.orderId, validOrderIds),
          sql`${orderItems.lockedSku} IS NULL AND ${orderItems.lockedMappingCodeId} IS NULL`,
        ))
        .limit(1)

      if (unresolvedItems.length > 0) {
        throw new Error('매핑 결과를 확정상품으로 저장하지 못했습니다.')
      }

      const updatedOrders = await tx
        .update(orders)
        .set({
          mappedAt: new Date(),
          mappedByUserId: user.id,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.userId, workspaceUserId), inArray(orders.id, validOrderIds)))
        .returning({ id: orders.id, mappedAt: orders.mappedAt })

      return updatedOrders
    })
  } catch (error) {
    return NextResponse.json({
      applied: 0,
      failed: validOrderIds.length + failures.length,
      failures,
      error: error instanceof Error ? error.message : '매핑 결과를 확정상품으로 저장하지 못했습니다.',
    }, { status: 409 })
  }

  await logOrderChanges(result.map((order) => ({
    orderId: order.id,
    userId: workspaceUserId,
    actorId: user.id,
    action: 'mapping.applied',
    title: '매핑완료',
    description: '주문 매핑이 완료 처리되었습니다.',
    after: { mappedAt: order.mappedAt },
  })))

  return NextResponse.json({ applied: result.length, failed: failures.length, failures })
}
