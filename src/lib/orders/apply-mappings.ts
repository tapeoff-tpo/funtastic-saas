/**
 * applyMappingsForUser
 *
 * 주문 항목(orderItems)에 매핑을 적용해서 SKU 를 사장님 내부 재고관리코드로
 * 갈아끼우고, 매핑이 끝난 신규 주문을 자동 확정(confirmed) + 자동 합포장한다.
 *
 * Lookup 우선순위 (구체적인 매핑이 우선):
 *   1) productOptionMappings  — (marketplaceId, productName, optionText) → variantSku
 *   2) productOptionMappings  — (marketplaceId, productName, "") fallback (옵션-비의존)
 *   3) productNameMappings    — (marketplaceId, productName) → 연결된 product/variant 의 SKU
 *
 * 어댑터가 이미 채워둔 벤더 SKU(예: 쿠팡 externalVendorSku)보다 사장님이 등록한
 * 매핑이 항상 우선이다 — lookup 적중 시 무조건 덮어쓴다.
 *
 * 미출고(보류) 주문은 대상에서 제외 — 어차피 배송 안 나가는 주문.
 */

import { db } from '@/lib/db'
import {
  orderItems,
  orders,
  productOptionMappings,
  productNameMappings,
  products,
  productVariants,
} from '@/lib/db/schema'
import { eq, and, isNull, inArray, notExists } from 'drizzle-orm'
import { runAutoCombineByContact } from '@/lib/shipping/auto-combine'

export interface ApplyMappingsResult {
  updated: number
  total: number
  autoCombined: { created: number; totalOrders: number }
  confirmed: number
}

export async function applyMappingsForUser(
  userId: string,
  opts: { orderIds?: string[] } = {},
): Promise<ApplyMappingsResult> {
  const conditions = [
    eq(orders.userId, userId),
    eq(orders.isHeld, false),
  ]
  if (opts.orderIds && opts.orderIds.length > 0) {
    conditions.push(inArray(orders.id, opts.orderIds))
  }

  const candidateItems = await db
    .select({
      itemId: orderItems.id,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      currentSku: orderItems.sku,
      marketplaceId: orders.marketplaceId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(...conditions))

  // candidate 가 0건이어도 — 이미 매핑돼 있는데 status='new' 로 stuck된 주문이
  // 있을 수 있으니 confirm-sweep 까지는 진행한다. 매핑 lookup 로딩만 건너뛴다.
  const skipMappingPhase = candidateItems.length === 0

  const updates: Array<{ itemId: string; variantSku: string; multiplier: number }> = []

  if (!skipMappingPhase) {
    // (1) Option mappings — (marketplaceId, productName, optionText) → variantSku
    // (2) Name mappings — (marketplaceId, productName) → product/variant.sku
    const [optionMaps, nameMaps] = await Promise.all([
      db
        .select({
          marketplaceId: productOptionMappings.marketplaceId,
          marketplaceName: productOptionMappings.marketplaceName,
          optionText: productOptionMappings.optionText,
          variantSku: productOptionMappings.variantSku,
          quantity: productOptionMappings.quantity,
        })
        .from(productOptionMappings)
        .where(eq(productOptionMappings.userId, userId)),
      db
        .select({
          marketplaceId: productNameMappings.marketplaceId,
          marketplaceName: productNameMappings.marketplaceName,
          quantity: productNameMappings.quantity,
          productInternalSku: products.internalSku,
          variantSku: productVariants.sku,
        })
        .from(productNameMappings)
        .leftJoin(products, eq(productNameMappings.productId, products.id))
        .leftJoin(productVariants, eq(productNameMappings.variantId, productVariants.id))
        .where(eq(productNameMappings.userId, userId)),
    ])

    // optionLookup: "marketplaceId::productName::optionText" → { sku, qty }
    //   - specific (optionText 있음) 키는 그대로 등록
    //   - empty-optionText 키는 product-level option fallback
    const optionLookup = new Map<string, { sku: string; qty: number }>()
    for (const m of optionMaps) {
      const val = { sku: m.variantSku, qty: m.quantity ?? 1 }
      optionLookup.set(`${m.marketplaceId}::${m.marketplaceName}::${m.optionText}`, val)
      const fallbackKey = `${m.marketplaceId}::${m.marketplaceName}::`
      if (!optionLookup.has(fallbackKey)) optionLookup.set(fallbackKey, val)
    }

    // nameLookup: "marketplaceId::productName" → { sku, qty }
    //   - variantSku 있으면 그것, 없으면 productInternalSku
    //   - 둘 다 null 이면 displayName-only 매핑이므로 lookup 에 넣지 않음
    const nameLookup = new Map<string, { sku: string; qty: number }>()
    for (const n of nameMaps) {
      const sku = n.variantSku ?? n.productInternalSku
      if (!sku) continue
      nameLookup.set(`${n.marketplaceId}::${n.marketplaceName}`, {
        sku,
        qty: n.quantity ?? 1,
      })
    }

    for (const item of candidateItems) {
      const optText = item.optionText?.trim() ?? ''
      const optKey = `${item.marketplaceId}::${item.productName}::${optText}`
      const optFallbackKey = `${item.marketplaceId}::${item.productName}::`
      const nameKey = `${item.marketplaceId}::${item.productName}`
      const hit =
        optionLookup.get(optKey) ??
        optionLookup.get(optFallbackKey) ??
        nameLookup.get(nameKey)
      if (hit && hit.sku !== item.currentSku) {
        // 매핑이 있고, 현재 SKU 와 다른 경우에만 갱신.
        // (어댑터가 채운 벤더 SKU 위로 사장님 내부 재고코드가 덮어쓰임)
        updates.push({ itemId: item.itemId, variantSku: hit.sku, multiplier: hit.qty })
      }
    }

    for (const u of updates) {
      await db
        .update(orderItems)
        .set({ sku: u.variantSku, skuMultiplier: u.multiplier })
        .where(eq(orderItems.id, u.itemId))
    }
  }

  const updated = updates.length

  // 매핑 완료된 신규 주문 → 확인(confirmed)으로 자동 전환.
  // opts.orderIds 가 있으면 그 범위, 없으면 방금 업데이트된 주문 범위에서.
  let autoCombined = { created: 0, totalOrders: 0 }
  let confirmed = 0

  const touchedItemIds = updates.map((u) => u.itemId)
  let touchedOrderIds: string[] = []
  if (touchedItemIds.length > 0) {
    const orderIdRows = await db
      .select({ orderId: orderItems.orderId })
      .from(orderItems)
      .where(inArray(orderItems.id, touchedItemIds))
    touchedOrderIds = [...new Set(orderIdRows.map((r) => r.orderId))]
  }

  const confirmCandidateIds = [
    ...new Set([...(opts.orderIds ?? []), ...touchedOrderIds]),
  ]

  if (confirmCandidateIds.length > 0) {
    try {
      const confirmedRows = await db
        .update(orders)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(
          and(
            eq(orders.userId, userId),
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

  // 매핑이 실제로 적용된 주문에 audit 기록 — 상세 페이지의 '매핑일자/매핑자' 표시용
  if (touchedOrderIds.length > 0) {
    try {
      await db
        .update(orders)
        .set({ mappedAt: new Date(), mappedByUserId: userId })
        .where(and(eq(orders.userId, userId), inArray(orders.id, touchedOrderIds)))
    } catch (err) {
      console.error('[apply-mappings] mapped audit update failed:', err)
    }
  }

  // 자동 합포장 (수령인 이름+주소+전화 동일 주문 2건 이상)
  if (updated > 0 && touchedOrderIds.length > 0) {
    try {
      autoCombined = await runAutoCombineByContact(userId, touchedOrderIds)
    } catch (err) {
      console.error('[apply-mappings] auto-combine failed:', err)
    }
  }

  return { updated, total: candidateItems.length, autoCombined, confirmed }
}
