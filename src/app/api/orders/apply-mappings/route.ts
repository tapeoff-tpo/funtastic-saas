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
import { mappingComponents, mappingSources, orderItems, orders, products, productVariants } from '@/lib/db/schema'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { and, eq, inArray } from 'drizzle-orm'
import { logOrderChanges } from '@/lib/orders/change-log'
import { buildMappingIndex, lookupMappingRef, type MappingSource } from '@/lib/orders/mapping-match'

type ValidationFailure = {
  orderId: string
  marketplaceOrderId: string
  reason: string
}

async function validateOrdersHaveInternalMappings(
  userId: string,
  orderIds: string[],
): Promise<{ validOrderIds: string[]; failures: ValidationFailure[] }> {
  const targetRows = await db
    .select({
      orderId: orders.id,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
      itemId: orderItems.id,
      marketplaceItemId: orderItems.marketplaceItemId,
      sku: orderItems.sku,
      optionText: orderItems.optionText,
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

  const [productRows, variantRows, sourceRows, componentRows] = await Promise.all([
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
      .select({
        mappingCodeId: mappingSources.mappingCodeId,
        marketplaceId: mappingSources.marketplaceId,
        marketplaceProductId: mappingSources.marketplaceProductId,
        marketplaceOptionId: mappingSources.marketplaceOptionId,
      })
      .from(mappingSources)
      .where(eq(mappingSources.userId, userId)),
    db
      .select({
        mappingCodeId: mappingComponents.mappingCodeId,
        sku: mappingComponents.sku,
      })
      .from(mappingComponents)
      .where(eq(mappingComponents.userId, userId)),
  ])

  const validSkus = new Set<string>()
  for (const row of productRows) validSkus.add(row.sku.trim())
  for (const row of variantRows) validSkus.add(row.sku.trim())

  const mappingIndex = buildMappingIndex(
    sourceRows.map<MappingSource>((row) => ({
      marketplaceId: row.marketplaceId,
      marketplaceProductId: row.marketplaceProductId,
      marketplaceOptionId: row.marketplaceOptionId,
      ref: row.mappingCodeId,
    })),
  )

  const componentsByCode = new Map<string, string[]>()
  for (const row of componentRows) {
    const list = componentsByCode.get(row.mappingCodeId) ?? []
    list.push(row.sku.trim())
    componentsByCode.set(row.mappingCodeId, list)
  }

  const isItemMapped = (item: typeof targetRows[number]): boolean => {
    const directSku = item.sku?.trim()
    if (directSku && validSkus.has(directSku)) return true

    const candidateIds = Array.from(new Set(
      [item.marketplaceItemId, item.sku]
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ))
    const mappingCodeId = candidateIds
      .map((candidateId) => lookupMappingRef(mappingIndex, item.marketplaceId, candidateId, item.optionText))
      .find((ref): ref is string => !!ref)
    if (!mappingCodeId) return false

    const componentSkus = componentsByCode.get(mappingCodeId) ?? []
    return componentSkus.length > 0 && componentSkus.every((sku) => validSkus.has(sku))
  }

  const validOrderIds: string[] = []
  const failures: ValidationFailure[] = []

  for (const orderId of orderIds) {
    const items = rowsByOrderId.get(orderId) ?? []
    const marketplaceOrderId = orderNoById.get(orderId) ?? orderId
    if (items.length === 0) {
      failures.push({ orderId, marketplaceOrderId, reason: '주문 품목이 없습니다.' })
      continue
    }

    const failedItem = items.find((item) => !isItemMapped(item))
    if (failedItem) {
      failures.push({
        orderId,
        marketplaceOrderId,
        reason: `내부 상품코드 매핑 실패: ${failedItem.sku || failedItem.marketplaceItemId || failedItem.itemId}`,
      })
      continue
    }

    validOrderIds.push(orderId)
  }

  return { validOrderIds, failures }
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

  const { validOrderIds, failures } = await validateOrdersHaveInternalMappings(workspaceUserId, orderIds)

  if (validOrderIds.length === 0) {
    return NextResponse.json({
      applied: 0,
      failed: failures.length,
      failures,
      error: failures[0]?.reason ?? '내부 상품코드로 매핑된 주문이 없습니다.',
    }, { status: 409 })
  }

  const result = await db
    .update(orders)
    .set({
      mappedAt: new Date(),
      mappedByUserId: user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.userId, workspaceUserId), inArray(orders.id, validOrderIds)))
    .returning({ id: orders.id, mappedAt: orders.mappedAt })

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
