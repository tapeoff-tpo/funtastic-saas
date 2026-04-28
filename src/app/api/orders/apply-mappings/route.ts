/**
 * POST /api/orders/apply-mappings
 *
 * Looks up productOptionMappings for every orderItem that lacks a SKU,
 * matching on (userId, marketplaceId, productName, optionText), and
 * writes the resolved variantSku back to orderItems.sku.
 *
 * Call this after saving new option mappings so the orders table
 * immediately reflects the correct SKUs.
 *
 * Body (optional): { orderIds?: string[] }  — limit to specific orders.
 * If omitted, applies to all orders for the user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orderItems, orders, productOptionMappings } from '@/lib/db/schema'
import { eq, and, isNull, inArray, notExists } from 'drizzle-orm'
import { runAutoCombineByContact } from '@/lib/shipping/auto-combine'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { orderIds?: string[] } = {}
  try { body = await req.json() } catch { /* optional body */ }

  // Find orderItems that still have no SKU, joined to their order's marketplaceId
  // 미출고(보류) 주문은 매핑 대상에서 제외 — 어차피 배송 안 나가는 주문
  const conditions = [
    eq(orders.userId, user.id),
    isNull(orderItems.sku),
    eq(orders.isHeld, false),
  ]
  if (body.orderIds && body.orderIds.length > 0) {
    conditions.push(inArray(orders.id, body.orderIds))
  }

  const unmappedItems = await db
    .select({
      itemId: orderItems.id,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      marketplaceId: orders.marketplaceId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(...conditions))

  // 미매핑 item이 0개여도 — 이미 매핑돼 있는데 status='new' 로 stuck된 주문이
  // 있을 수 있으므로 confirm-sweep 까지 진행한다. 옵션맵 로딩은 건너뛴다.
  const skipMappingPhase = unmappedItems.length === 0

  // Resolve SKUs and update (skip if everything already mapped)
  let updated = 0
  const updates: Array<{ itemId: string; variantSku: string; multiplier: number }> = []

  if (!skipMappingPhase) {
    // Load all option mappings for this user once
    const optionMaps = await db
      .select({
        marketplaceId: productOptionMappings.marketplaceId,
        marketplaceName: productOptionMappings.marketplaceName,
        optionText: productOptionMappings.optionText,
        variantSku: productOptionMappings.variantSku,
        quantity: productOptionMappings.quantity,
      })
      .from(productOptionMappings)
      .where(eq(productOptionMappings.userId, user.id))

    // Build lookup: "marketplaceId::productName::optionText" → { sku, qty }
    const lookup = new Map<string, { sku: string; qty: number }>()
    for (const m of optionMaps) {
      const val = { sku: m.variantSku, qty: m.quantity ?? 1 }
      lookup.set(`${m.marketplaceId}::${m.marketplaceName}::${m.optionText}`, val)
      // Also try empty optionText as fallback (product-level option mapping)
      if (!lookup.has(`${m.marketplaceId}::${m.marketplaceName}::`)) {
        lookup.set(`${m.marketplaceId}::${m.marketplaceName}::`, val)
      }
    }

    for (const item of unmappedItems) {
      const optText = item.optionText?.trim() ?? ''
      const key = `${item.marketplaceId}::${item.productName}::${optText}`
      const hit = lookup.get(key) ?? lookup.get(`${item.marketplaceId}::${item.productName}::`)
      if (hit) {
        updates.push({ itemId: item.itemId, variantSku: hit.sku, multiplier: hit.qty })
      }
    }

    for (const u of updates) {
      await db
        .update(orderItems)
        .set({ sku: u.variantSku, skuMultiplier: u.multiplier })
        .where(eq(orderItems.id, u.itemId))
      updated += 1
    }
  }

  // 매핑 완료된 신규 주문 → 확인(confirmed)으로 자동 전환.
  // body.orderIds 가 있으면 그 범위에서, 없으면 방금 업데이트된 주문 범위에서.
  // (이미 매핑돼 있었지만 status='new' 로 머물러 있던 주문도 같이 정리)
  let autoCombined = { created: 0, totalOrders: 0 }
  let confirmed = 0

  // 방금 업데이트된 itemId → orderId
  const touchedItemIds = updates.map((u) => u.itemId)
  let touchedOrderIds: string[] = []
  if (touchedItemIds.length > 0) {
    const orderIdRows = await db
      .select({ orderId: orderItems.orderId })
      .from(orderItems)
      .where(inArray(orderItems.id, touchedItemIds))
    touchedOrderIds = [...new Set(orderIdRows.map((r) => r.orderId))]
  }

  // 확정 후보: body.orderIds (요청 범위) ∪ touchedOrderIds
  const confirmCandidateIds = [
    ...new Set([...(body.orderIds ?? []), ...touchedOrderIds]),
  ]

  if (confirmCandidateIds.length > 0) {
    try {
      const confirmedRows = await db
        .update(orders)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(
          and(
            eq(orders.userId, user.id),
            eq(orders.status, 'new'),
            inArray(orders.id, confirmCandidateIds),
            notExists(
              db
                .select({ x: orderItems.id })
                .from(orderItems)
                .where(and(eq(orderItems.orderId, orders.id), isNull(orderItems.sku))),
            ),
          ),
        )
        .returning({ id: orders.id })
      confirmed = confirmedRows.length
    } catch (err) {
      console.error('[apply-mappings] auto-confirm failed:', err)
    }
  }

  // 자동 합포장 (수령인 이름+주소+전화 동일 주문 2건 이상)
  if (updated > 0 && touchedOrderIds.length > 0) {
    try {
      autoCombined = await runAutoCombineByContact(user.id, touchedOrderIds)
    } catch (err) {
      // 자동 합포장 실패해도 매핑 적용은 성공으로 처리
      console.error('[apply-mappings] auto-combine failed:', err)
    }
  }

  return NextResponse.json({ updated, total: unmappedItems.length, autoCombined, confirmed })
}
