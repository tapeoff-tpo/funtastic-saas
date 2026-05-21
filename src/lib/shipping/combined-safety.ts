import { db } from '@/lib/db'
import {
  claims,
  orders,
  shipments,
  shipmentGroupOrders,
  shipmentGroups,
} from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

const ACTIVE_CLAIM_STATUSES = ['requested', 'processing', 'completed'] as const

export function hasRequiredCombineAddress(order: {
  recipientName: string | null
  shippingAddress: { zipCode?: string | null; address1?: string | null; address2?: string | null } | null
}): order is {
  recipientName: string
  shippingAddress: { zipCode: string; address1: string; address2?: string | null }
} {
  return Boolean(
    order.recipientName &&
    order.shippingAddress?.zipCode &&
    order.shippingAddress?.address1,
  )
}

/**
 * 자동 합포장 고정 기준.
 * - 같은 마켓
 * - 수취인명은 DB 값 완전 동일
 * - 우편번호/주소/상세주소는 DB 값 완전 동일
 * - 주문번호/전화번호는 기준에서 제외
 */
export function buildAutoCombineKey(order: {
  marketplaceId: string
  recipientName: string
  shippingAddress: { zipCode: string; address1: string; address2?: string | null }
}): string {
  return [
    order.marketplaceId,
    order.recipientName,
    order.shippingAddress.zipCode,
    order.shippingAddress.address1,
    order.shippingAddress.address2 ?? '',
  ].join('|')
}

export async function getBlockedClaimOrderIds(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set()

  const rows = await db
    .select({ orderId: claims.orderId })
    .from(claims)
    .where(and(
      inArray(claims.orderId, orderIds),
      inArray(claims.claimType, ['cancel', 'return', 'exchange']),
      inArray(claims.claimStatus, [...ACTIVE_CLAIM_STATUSES]),
    ))

  return new Set(rows.map((row) => row.orderId))
}

export async function getCombinedShipmentGroupIds(
  userId: string,
  orderIds: string[],
): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map()

  const rows = await db
    .select({
      orderId: shipmentGroupOrders.orderId,
      groupId: shipmentGroups.id,
    })
    .from(shipmentGroupOrders)
    .innerJoin(shipmentGroups, eq(shipmentGroupOrders.shipmentGroupId, shipmentGroups.id))
    .where(and(
      eq(shipmentGroups.userId, userId),
      inArray(shipmentGroupOrders.orderId, orderIds),
    ))

  const groupIds = [...new Set(rows.map((row) => row.groupId))]
  if (groupIds.length === 0) return new Map()

  const countRows = await db
    .select({
      orderId: shipmentGroupOrders.orderId,
      groupId: shipmentGroupOrders.shipmentGroupId,
    })
    .from(shipmentGroupOrders)
    .where(inArray(shipmentGroupOrders.shipmentGroupId, groupIds))

  const counts = new Map<string, number>()
  for (const row of countRows) {
    counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + 1)
  }

  const byOrder = new Map<string, string>()
  for (const row of rows) {
    if ((counts.get(row.groupId) ?? 0) >= 2) {
      byOrder.set(row.orderId, row.groupId)
    }
  }
  return byOrder
}

/**
 * 합포장 그룹 안에서 택배사나 송장번호가 서로 달라지면 그룹을 해제한다.
 * 화면 행은 주문 단위로 유지하고, 내부 shipment group 만 제거한다.
 */
export async function releaseShipmentGroupsWithConflictingShipments(
  userId: string,
  scopeOrderIds?: string[],
): Promise<number> {
  const scopedGroupRows = scopeOrderIds && scopeOrderIds.length > 0
    ? await db
        .select({ groupId: shipmentGroups.id })
        .from(shipmentGroupOrders)
        .innerJoin(shipmentGroups, eq(shipmentGroupOrders.shipmentGroupId, shipmentGroups.id))
        .where(and(
          eq(shipmentGroups.userId, userId),
          inArray(shipmentGroupOrders.orderId, scopeOrderIds),
        ))
    : await db
        .select({ groupId: shipmentGroups.id })
        .from(shipmentGroups)
        .where(eq(shipmentGroups.userId, userId))

  const groupIds = [...new Set(scopedGroupRows.map((row) => row.groupId))]
  if (groupIds.length === 0) return 0

  const rows = await db
    .select({
      groupId: shipmentGroups.id,
      orderId: shipmentGroupOrders.orderId,
      trackingNumber: shipments.trackingNumber,
      carrierId: shipments.carrierId,
    })
    .from(shipmentGroupOrders)
    .innerJoin(shipmentGroups, eq(shipmentGroupOrders.shipmentGroupId, shipmentGroups.id))
    .innerJoin(orders, eq(orders.id, shipmentGroupOrders.orderId))
    .leftJoin(shipments, eq(shipments.orderId, orders.id))
    .where(and(
      eq(shipmentGroups.userId, userId),
      inArray(shipmentGroups.id, groupIds),
    ))

  const byGroup = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = byGroup.get(row.groupId) ?? []
    list.push(row)
    byGroup.set(row.groupId, list)
  }

  const releaseIds: string[] = []
  for (const [groupId, list] of byGroup) {
    const carrierIds = new Set(list.map((row) => row.carrierId).filter(Boolean))
    const trackingNumbers = new Set(list.map((row) => row.trackingNumber).filter(Boolean))
    if (carrierIds.size > 1 || trackingNumbers.size > 1) {
      releaseIds.push(groupId)
    }
  }

  if (releaseIds.length === 0) return 0
  await db.delete(shipmentGroups).where(inArray(shipmentGroups.id, releaseIds))
  return releaseIds.length
}
