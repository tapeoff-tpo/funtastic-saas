/**
 * POST /api/orders/split-sets
 *
 * 매핑완료 주문 중 세트 매핑(한 주문상품 → 여러 재고 SKU)을 실제 주문 줄로 분리한다.
 * - 원본 주문은 첫 번째 구성품 1줄만 남긴다.
 * - 나머지 구성품은 복사 주문(isCopy=true)으로 생성한다.
 * - rawData.setSplit 로 재실행 방지와 원본 추적 정보를 남긴다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orderItems, orders } from '@/lib/db/schema'
import { expandOrderItemsWithMapping, type ExpandedRow } from '@/lib/orders/mapping-expand'
import { generateInternalNo } from '@/lib/orders/internal-no'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

interface SplitSetsBody {
  orderIds?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasSetSplit(rawData: Record<string, unknown> | null | undefined): boolean {
  return isRecord(rawData?.setSplit)
}

function withSetSplit(
  rawData: Record<string, unknown> | null | undefined,
  setSplit: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(rawData ?? {}),
    setSplit,
  }
}

function itemValues(orderId: string, row: ExpandedRow) {
  return {
    orderId,
    marketplaceItemId: row.source.marketplaceItemId,
    productName: row.productName || row.sku || row.source.productName || '',
    optionText: row.optionText || null,
    quantity: Math.max(1, row.quantity),
    unitPrice: row.source.unitPrice ?? '0',
    sku: row.sku || null,
    skuMultiplier: 1,
    fulfillmentCode: 'set-split',
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: SplitSetsBody
  try {
    body = await req.json() as SplitSetsBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const orderIds = Array.isArray(body.orderIds)
    ? Array.from(new Set(body.orderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    : []

  if (orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds must be a non-empty array' }, { status: 400 })
  }

  const targetOrders = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, workspaceUserId), inArray(orders.id, orderIds)))

  if (targetOrders.length === 0) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  }

  const targetOrderIds = targetOrders.map((order) => order.id)
  const sourceItems = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, targetOrderIds))

  const expandedRows = await expandOrderItemsWithMapping(
    workspaceUserId,
    targetOrders.map((order) => ({ id: order.id, marketplaceId: order.marketplaceId })),
    sourceItems,
  )

  const expandedByOrder = new Map<string, ExpandedRow[]>()
  for (const row of expandedRows) {
    const list = expandedByOrder.get(row.orderId) ?? []
    list.push(row)
    expandedByOrder.set(row.orderId, list)
  }

  let splitOrders = 0
  let createdCopies = 0
  let skipped = 0
  const now = new Date()

  await db.transaction(async (tx) => {
    for (const order of targetOrders) {
      const rows = expandedByOrder.get(order.id) ?? []
      const mappedPartCountByItem = new Map<string, number>()
      for (const row of rows) {
        if (!row.fromMapping) continue
        mappedPartCountByItem.set(row.orderItemId, (mappedPartCountByItem.get(row.orderItemId) ?? 0) + 1)
      }
      const hasExpandedSet = Array.from(mappedPartCountByItem.values()).some((count) => count > 1)

      if (
        order.isCopy ||
        order.status !== 'new' ||
        !order.mappedAt ||
        hasSetSplit(order.rawData) ||
        rows.length <= 1 ||
        !hasExpandedSet
      ) {
        skipped += 1
        continue
      }

      const splitMeta = {
        splitAt: now.toISOString(),
        sourceOrderId: order.id,
        totalParts: rows.length,
      }

      await tx.delete(orderItems).where(eq(orderItems.orderId, order.id))
      await tx.insert(orderItems).values(itemValues(order.id, rows[0]))
      await tx
        .update(orders)
        .set({
          rawData: withSetSplit(order.rawData, { ...splitMeta, partIndex: 1, original: true }),
          updatedAt: now,
        })
        .where(eq(orders.id, order.id))

      for (let index = 1; index < rows.length; index += 1) {
        const [copy] = await tx
          .insert(orders)
          .values({
            internalNo: generateInternalNo(),
            userId: order.userId,
            connectionId: order.connectionId,
            marketplaceId: order.marketplaceId,
            marketplaceOrderId: order.marketplaceOrderId,
            status: order.status,
            previousStatus: order.previousStatus,
            buyerName: order.buyerName,
            buyerPhone: order.buyerPhone,
            buyerPhone2: order.buyerPhone2,
            recipientName: order.recipientName,
            recipientPhone: order.recipientPhone,
            recipientPhone2: order.recipientPhone2,
            shippingAddress: order.shippingAddress,
            orderedAt: order.orderedAt,
            totalAmount: order.totalAmount,
            isHeld: order.isHeld,
            holdReason: order.holdReason,
            heldAt: order.heldAt,
            logisticsMessage: order.logisticsMessage,
            deliveryMessage: order.deliveryMessage,
            rawData: withSetSplit(order.rawData, { ...splitMeta, partIndex: index + 1, originalOrderId: order.id }),
            marketplaceStatus: order.marketplaceStatus,
            collectedAt: order.collectedAt,
            shippingType: order.shippingType,
            shippingFee: order.shippingFee,
            isCopy: true,
            mappedAt: order.mappedAt,
            mappedByUserId: order.mappedByUserId,
            preparingAt: order.preparingAt,
            updatedAt: now,
          })
          .returning({ id: orders.id })

        await tx.insert(orderItems).values(itemValues(copy.id, rows[index]))
        createdCopies += 1
      }

      splitOrders += 1
    }
  })

  return NextResponse.json({ splitOrders, createdCopies, skipped })
}
