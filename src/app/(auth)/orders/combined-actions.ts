'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, orderItems } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { createShipmentGroup } from '@/lib/shipping/combined-queries'

/**
 * 확정대기 단계에서 이름 + 연락처(수령인 기준)가 동일한 주문을
 * 일괄 합포장 그룹으로 만든다.
 *
 * - 수령인 이름과 전화번호가 모두 동일하고 2건 이상인 경우 그룹화
 * - fulfillmentCode별로 추가 분리 (혼합배송 방지)
 * - maxPackQuantity(기본 10)로 chunking
 * - 선택된 orderIds 내에서만 (없으면 user의 미출고 전체)
 */
export async function bulkCombineByContactAction(
  orderIds?: string[],
): Promise<{ created: number; totalOrders: number }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { created: 0, totalOrders: 0 }
  const userId = user.id

  const conditions = [eq(orders.userId, userId)]
  if (orderIds && orderIds.length > 0) {
    conditions.push(inArray(orders.id, orderIds))
  } else {
    // 기본: 확정대기 단계 (status='new', 매핑완료는 items에서 개별 판단 불가 → status만)
    conditions.push(eq(orders.status, 'new'))
  }

  const orderRows = await db
    .select({
      id: orders.id,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
    })
    .from(orders)
    .where(and(...conditions))

  if (orderRows.length === 0) return { created: 0, totalOrders: 0 }

  // 연락처 기준 그룹화 (이름 + 전화)
  const groupsMap = new Map<string, typeof orderRows>()
  for (const o of orderRows) {
    const name = (o.recipientName ?? '').trim()
    const phone = (o.recipientPhone ?? '').replace(/[^\d]/g, '') // 숫자만
    if (!name || !phone) continue
    const key = `${name}|${phone}`
    const list = groupsMap.get(key) ?? []
    list.push(o)
    groupsMap.set(key, list)
  }

  // 2건 이상인 그룹만 유지
  const mergeKeys = [...groupsMap.entries()].filter(([, list]) => list.length >= 2)

  if (mergeKeys.length === 0) return { created: 0, totalOrders: 0 }

  // fulfillmentCode별 분리를 위해 해당 주문 items 조회
  const allOrderIds = mergeKeys.flatMap(([, list]) => list.map((o) => o.id))
  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      fulfillmentCode: orderItems.fulfillmentCode,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, allOrderIds))

  const orderFulfillment = new Map<string, string>()
  const perOrderCodes = new Map<string, Set<string>>()
  for (const row of itemRows) {
    const set = perOrderCodes.get(row.orderId) ?? new Set<string>()
    set.add(row.fulfillmentCode || 'normal')
    perOrderCodes.set(row.orderId, set)
  }
  for (const [oid, codes] of perOrderCodes) {
    orderFulfillment.set(oid, codes.size === 1 ? [...codes][0] : 'mixed')
  }

  const MAX_PACK = 10
  let created = 0
  let totalOrders = 0

  for (const [key, list] of mergeKeys) {
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
      // chunking
      for (let i = 0; i < ids.length; i += MAX_PACK) {
        const chunk = ids.slice(i, i + MAX_PACK)
        if (chunk.length < 2) continue
        await createShipmentGroup({
          userId,
          groupKey: `contact|${key}|${code}`,
          fulfillmentCode: code,
          orderIds: chunk,
        })
        created += 1
        totalOrders += chunk.length
      }
    }
  }

  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  revalidatePath('/shipping/combined')
  return { created, totalOrders }
}
