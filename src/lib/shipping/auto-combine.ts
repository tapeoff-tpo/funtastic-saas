/**
 * 자동 합포장 로직 (수령인 이름 + 주소 + 전화 기준).
 *
 * 매핑 적용 직후 또는 명시적으로 호출되어, 해당 사용자의
 * 미출고 주문 중 수령인 이름/주소/전화가 동일한 묶음을 찾아
 * shipmentGroups 로 생성한다. 이미 그룹에 속한 주문은 제외.
 */

import { db } from '@/lib/db'
import {
  orders,
  orderItems,
  shipmentGroupOrders,
} from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { createShipmentGroup } from './combined-queries'
import { normalizeAddress } from './combined-shipping'

const MAX_PACK = 10

/** 전화번호 정규화: 숫자만 남김 */
function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^\d]/g, '')
}

export interface AutoCombineResult {
  created: number
  totalOrders: number
}

/**
 * 자동 합포장 실행.
 *
 * @param userId - 대상 사용자
 * @param scopeOrderIds - 합포장 후보로 포함할 주문 ID (생략 시 사용자의 모든 미출고 주문)
 *                       단, 그룹 매칭은 항상 사용자의 전체 미출고 주문 범위에서 수행.
 */
export async function runAutoCombineByContact(
  userId: string,
  scopeOrderIds?: string[],
): Promise<AutoCombineResult> {
  // 이미 shipmentGroup에 속한 주문 ID 수집 (중복 그룹화 방지)
  const alreadyGrouped = await db
    .select({ orderId: shipmentGroupOrders.orderId })
    .from(shipmentGroupOrders)
  const groupedSet = new Set(alreadyGrouped.map((r) => r.orderId))

  // 사용자의 미출고 주문 + 필요한 필드 조회
  // 미출고 = status가 new/confirmed/preparing (shipped/delivering/delivered/cancelled 제외)
  const candidates = await db
    .select({
      id: orders.id,
      status: orders.status,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
      shippingAddress: orders.shippingAddress,
    })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        inArray(orders.status, ['new', 'confirmed', 'preparing']),
      ),
    )

  // 그룹 매칭 대상 필터링
  const eligible = candidates.filter((o) => !groupedSet.has(o.id))
  if (eligible.length < 2) return { created: 0, totalOrders: 0 }

  // 이름 + 주소 + 전화 기준 그룹화
  type Candidate = (typeof eligible)[number]
  const byKey = new Map<string, Candidate[]>()
  for (const o of eligible) {
    const name = (o.recipientName ?? '').trim()
    const phone = normalizePhone(o.recipientPhone)
    const addr = o.shippingAddress as {
      zipCode?: string
      address1?: string
      address2?: string
    } | null
    if (!name || !phone || !addr?.zipCode || !addr?.address1) continue
    const addrKey = normalizeAddress({
      zipCode: addr.zipCode,
      address1: addr.address1,
      address2: addr.address2,
    })
    const key = `${name}|${phone}|${addrKey}`
    const list = byKey.get(key) ?? []
    list.push(o)
    byKey.set(key, list)
  }

  // 2건 이상 그룹만 유지
  const mergeKeys = [...byKey.entries()].filter(([, list]) => list.length >= 2)
  if (mergeKeys.length === 0) return { created: 0, totalOrders: 0 }

  // scopeOrderIds가 있으면 해당 주문이 포함된 그룹만 대상 (선택적 필터)
  const scopedKeys = scopeOrderIds && scopeOrderIds.length > 0
    ? mergeKeys.filter(([, list]) => list.some((o) => scopeOrderIds.includes(o.id)))
    : mergeKeys

  if (scopedKeys.length === 0) return { created: 0, totalOrders: 0 }

  // fulfillmentCode 조회를 위해 관련 주문의 items 조회
  const relatedIds = scopedKeys.flatMap(([, list]) => list.map((o) => o.id))
  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      fulfillmentCode: orderItems.fulfillmentCode,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, relatedIds))

  const perOrderCodes = new Map<string, Set<string>>()
  for (const row of itemRows) {
    const set = perOrderCodes.get(row.orderId) ?? new Set<string>()
    set.add(row.fulfillmentCode || 'normal')
    perOrderCodes.set(row.orderId, set)
  }
  const orderFulfillment = new Map<string, string>()
  for (const [oid, codes] of perOrderCodes) {
    orderFulfillment.set(oid, codes.size === 1 ? [...codes][0] : 'mixed')
  }

  let created = 0
  let totalOrders = 0

  for (const [key, list] of scopedKeys) {
    // fulfillmentCode별 sub-그룹화
    const subGroups = new Map<string, string[]>()
    for (const o of list) {
      const code = orderFulfillment.get(o.id) ?? 'normal'
      const sub = subGroups.get(code) ?? []
      sub.push(o.id)
      subGroups.set(code, sub)
    }

    for (const [code, ids] of subGroups) {
      if (ids.length < 2) continue
      for (let i = 0; i < ids.length; i += MAX_PACK) {
        const chunk = ids.slice(i, i + MAX_PACK)
        if (chunk.length < 2) continue
        await createShipmentGroup({
          userId,
          groupKey: `auto|${key}|${code}`,
          fulfillmentCode: code,
          orderIds: chunk,
        })
        created += 1
        totalOrders += chunk.length
      }
    }
  }

  return { created, totalOrders }
}
