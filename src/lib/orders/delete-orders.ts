/**
 * 주문 일괄 삭제 — 관련 row 까지 전체 정리.
 *
 * orders FK 가 cascade 안 걸린 테이블이 몇 개 있어서 트랜잭션 안에서
 * 명시적으로 dependent row 부터 정리한 뒤 orders 를 삭제한다.
 *
 * - inventoryHistory: orderId NULL 처리 (재고 변동 이력은 보존)
 * - shipments / claims / shipmentGroupOrders: 삭제
 * - orderItems / orderMemos: orders 삭제 시 cascade
 * - inquiries: orderId set null (스키마 onDelete)
 */

import { db } from '@/lib/db'
import {
  orders,
  orderItems,
  shipments,
  shipmentItems,
  claims,
  shipmentGroupOrders,
  inventoryHistory,
} from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

export interface DeleteOrdersResult {
  deleted: number
  errors: string[]
}

export async function deleteOrdersForUser(
  orderIds: string[],
  userId: string,
): Promise<DeleteOrdersResult> {
  if (orderIds.length === 0) return { deleted: 0, errors: [] }

  // userId 스코프 검증 — 다른 사용자 주문은 절대 삭제 불가
  const ownedRows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(inArray(orders.id, orderIds), eq(orders.userId, userId)))
  const owned = ownedRows.map((r) => r.id)
  if (owned.length === 0) return { deleted: 0, errors: ['삭제 가능한 주문이 없습니다.'] }

  const errors: string[] = []

  await db.transaction(async (tx) => {
    // 재고 변동 이력은 보존 — orderId 만 NULL 처리
    await tx
      .update(inventoryHistory)
      .set({ orderId: null })
      .where(inArray(inventoryHistory.orderId, owned))

    await tx.delete(shipmentGroupOrders).where(inArray(shipmentGroupOrders.orderId, owned))

    const linkedOrderItems = await tx
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(inArray(orderItems.orderId, owned))
    const orderItemIds = linkedOrderItems.map((item) => item.id)
    if (orderItemIds.length > 0) {
      await tx.delete(shipmentItems).where(inArray(shipmentItems.orderItemId, orderItemIds))
    }

    const linkedShipments = await tx
      .select({ id: shipments.id })
      .from(shipments)
      .where(inArray(shipments.orderId, owned))
    const shipmentIds = linkedShipments.map((shipment) => shipment.id)
    if (shipmentIds.length > 0) {
      await tx.delete(shipmentItems).where(inArray(shipmentItems.shipmentId, shipmentIds))
    }

    await tx.delete(shipments).where(inArray(shipments.orderId, owned))
    await tx.delete(claims).where(inArray(claims.orderId, owned))
    // orderItems / orderMemos / inquiries 는 schema FK 정책에 의해 자동 처리
    await tx.delete(orders).where(inArray(orders.id, owned))
  }).catch((err) => {
    errors.push(err instanceof Error ? err.message : String(err))
  })

  return {
    deleted: errors.length === 0 ? owned.length : 0,
    errors,
  }
}
