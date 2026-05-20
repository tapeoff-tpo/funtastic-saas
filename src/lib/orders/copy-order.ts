/**
 * 주문 복사 — 원본 주문 + orderItems 만 복제 (claims/shipments/memos 제외).
 * is_copy=true 로 마킹 → partial unique index 가 복사본을 제외하므로
 * marketplaceOrderId 를 원본과 동일하게 유지 가능.
 */

import { db } from '@/lib/db'
import { orders, orderItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { generateInternalNo } from './internal-no'
import type { OrderStatus } from './types'

export interface CopyOrderResult {
  success: boolean
  newOrderId?: string
  error?: string
}

interface CopyOrderOptions {
  status?: OrderStatus
  marketplaceStatus?: string | null
  logisticsMessage?: string | null
  rawData?: Record<string, unknown> | null
  itemQuantities?: Array<{ orderItemId: string; quantity: number }>
}

export async function copyOrder(
  orderId: string,
  userId: string,
  options: CopyOrderOptions = {},
): Promise<CopyOrderResult> {
  // 원본 주문 — userId 스코프로 권한 검증 겸용
  const [src] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1)
  if (!src) return { success: false, error: '원본 주문을 찾을 수 없습니다.' }

  const srcItems = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  const quantityByItemId = new Map(
    options.itemQuantities
      ?.map((item) => [item.orderItemId, Math.max(0, Math.floor(item.quantity))] as const)
      .filter(([, quantity]) => quantity > 0) ?? [],
  )
  const itemsToCopy = quantityByItemId.size > 0
    ? srcItems
        .map((it) => ({ ...it, quantity: Math.min(it.quantity, quantityByItemId.get(it.id) ?? 0) }))
        .filter((it) => it.quantity > 0)
    : srcItems
  if (quantityByItemId.size > 0 && itemsToCopy.length === 0) {
    return { success: false, error: '복사할 접수 수량이 없습니다.' }
  }

  const [inserted] = await db
    .insert(orders)
    .values({
      internalNo: generateInternalNo(),
      userId: src.userId,
      connectionId: src.connectionId,
      marketplaceId: src.marketplaceId,
      marketplaceOrderId: src.marketplaceOrderId,
      status: options.status ?? 'new',
      previousStatus: null,
      buyerName: src.buyerName,
      buyerPhone: src.buyerPhone,
      buyerPhone2: src.buyerPhone2,
      recipientName: src.recipientName,
      recipientPhone: src.recipientPhone,
      recipientPhone2: src.recipientPhone2,
      shippingAddress: src.shippingAddress,
      orderedAt: src.orderedAt,
      totalAmount: src.totalAmount,
      isHeld: false,
      holdReason: null,
      heldAt: null,
      logisticsMessage: options.logisticsMessage ?? null,
      deliveryMessage: src.deliveryMessage,
      rawData: options.rawData ?? src.rawData,
      marketplaceStatus: options.marketplaceStatus ?? src.marketplaceStatus,
      collectedAt: src.collectedAt,
      shippingType: src.shippingType,
      shippingFee: src.shippingFee,
      isCopy: true,
    })
    .returning({ id: orders.id })

  if (!inserted) return { success: false, error: '복사 실패 (insert returned no row)' }

  if (itemsToCopy.length > 0) {
    await db.insert(orderItems).values(
      itemsToCopy.map((it) => ({
        orderId: inserted.id,
        marketplaceItemId: it.marketplaceItemId,
        productName: it.productName,
        optionText: it.optionText,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        sku: it.sku,
        skuMultiplier: it.skuMultiplier,
        fulfillmentCode: it.fulfillmentCode,
      })),
    )
  }

  return { success: true, newOrderId: inserted.id }
}
