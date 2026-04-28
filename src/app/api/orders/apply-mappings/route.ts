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
import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
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

  if (unmappedItems.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

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

  // Resolve SKUs and update
  let updated = 0
  const updates: Array<{ itemId: string; variantSku: string; multiplier: number }> = []

  for (const item of unmappedItems) {
    const optText = item.optionText?.trim() ?? ''
    const key = `${item.marketplaceId}::${item.productName}::${optText}`
    const hit = lookup.get(key) ?? lookup.get(`${item.marketplaceId}::${item.productName}::`)
    if (hit) {
      updates.push({ itemId: item.itemId, variantSku: hit.sku, multiplier: hit.qty })
    }
  }

  if (updates.length > 0) {
    for (const u of updates) {
      await db
        .update(orderItems)
        .set({ sku: u.variantSku, skuMultiplier: u.multiplier })
        .where(eq(orderItems.id, u.itemId))
      updated += 1
    }
  }

  // 매핑 적용 직후 자동 합포장 (수령인 이름+주소+전화 동일 주문 2건 이상)
  let autoCombined = { created: 0, totalOrders: 0 }
  let confirmed = 0
  if (updated > 0) {
    // 방금 업데이트된 itemId → orderId 조회
    const touchedItemIds = updates.map((u) => u.itemId)
    const orderIdRows = await db
      .select({ orderId: orderItems.orderId })
      .from(orderItems)
      .where(inArray(orderItems.id, touchedItemIds))
    const touchedOrderIds = [...new Set(orderIdRows.map((r) => r.orderId))]

    if (touchedOrderIds.length > 0) {
      // 매핑 완료된 신규 주문 → 확인(confirmed)으로 자동 전환
      // 조건: status='new' AND sku IS NULL 인 itemorders 가 더 이상 없음
      try {
        const result = await db.execute(sql`
          UPDATE orders
          SET status = 'confirmed', updated_at = NOW()
          WHERE user_id = ${user.id}
            AND status = 'new'
            AND id = ANY(${touchedOrderIds}::uuid[])
            AND NOT EXISTS (
              SELECT 1 FROM order_items
              WHERE order_id = orders.id AND sku IS NULL
            )
        `)
        confirmed = (result as unknown as { rowCount?: number }).rowCount ?? 0
      } catch (err) {
        console.error('[apply-mappings] auto-confirm failed:', err)
      }

      // 자동 합포장
      try {
        autoCombined = await runAutoCombineByContact(user.id, touchedOrderIds)
      } catch (err) {
        // 자동 합포장 실패해도 매핑 적용은 성공으로 처리
        console.error('[apply-mappings] auto-combine failed:', err)
      }
    }
  }

  return NextResponse.json({ updated, total: unmappedItems.length, autoCombined, confirmed })
}
