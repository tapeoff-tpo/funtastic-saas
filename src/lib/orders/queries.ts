/**
 * Order queries with server-side filtering and pagination.
 *
 * Used by the dashboard to list, filter, and paginate orders.
 * All queries run server-side (offset/limit pagination acceptable for admin tool).
 */

import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { orders, orderItems, claims, shipments, orderMemos, products, productVariants, inventory, shipmentGroups, shipmentGroupOrders, scanLogs, mappingSources, mappingComponents } from '@/lib/db/schema'
import { eq, and, or, ilike, gte, lte, desc, asc, sql, count, countDistinct, inArray, isNotNull, exists } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { OrderFilters, MappingStatus, OrderStage, OrderStats } from './types'
// re-export so existing imports `import { OrderStats } from '@/lib/orders/queries'` keep working
export type { OrderStats }
import { listInquiriesByOrderIds } from './inquiry-queries'
import { buildMappingIndex, lookupMappingRef, type MappingSource } from './mapping-match'

/**
 * mappingStatus 계산용 SKU 인벤토리 캐시 (60초).
 *
 * Phase C — 매핑코드 시스템:
 * mappingStatus 는 mapping_sources(marketplaceId + marketplaceItemId) 매칭으로 판정.
 * SKU 직접 매칭은 fallback 용도로 유지 (마켓상품ID가 없는 임포트 주문 등).
 */
const getMappingLookupsCached = unstable_cache(
  async (userId: string) => {
    const [productSkus, variantSkus, sources, components] = await Promise.all([
      db
        .select({ sku: products.internalSku })
        .from(products)
        .where(eq(products.userId, userId)),
      db
        .select({ sku: productVariants.sku })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
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
          quantity: mappingComponents.quantity,
          productName: inventory.productName,
          optionName: inventory.optionName,
          availableStock: inventory.availableStock,
        })
        .from(mappingComponents)
        .leftJoin(
          inventory,
          and(
            eq(inventory.userId, mappingComponents.userId),
            eq(inventory.sku, mappingComponents.sku),
          ),
        )
        .where(eq(mappingComponents.userId, userId)),
    ])
    return { productSkus, variantSkus, sources, components }
  },
  ['order-mapping-lookups'],
  { revalidate: 60, tags: ['product-mappings'] },
)

/**
 * perf: getOrderStats 는 5개 병렬 COUNT 쿼리. 탭 전환 사이엔 값이 거의 안 변함.
 * 30초 캐시 + 주문 변경 시 `revalidateTag('orders')` 로 무효화.
 */
const getOrderStatsCached = unstable_cache(
  async (userId: string): Promise<OrderStats> => getOrderStatsImpl(userId),
  ['order-stats'],
  { revalidate: 30, tags: ['orders'] },
)

/** 주문이 특정 단계에 속하는지 판정 */
export function matchStage(
  order: {
    status: string
    mappingStatus: MappingStatus
    trackingNumber: string | null
  },
  stage: OrderStage,
): boolean {
  const s = order.status
  const isActive = s !== 'cancelled' && s !== 'delivered'
  switch (stage) {
    case 'prep':
      // 출고 준비 = 매핑 필요 ∪ 확정 대기
      return (
        (isActive && order.mappingStatus !== 'mapped') ||
        (s === 'new' && order.mappingStatus === 'mapped')
      )
    case 'mapping':
      return isActive && order.mappingStatus !== 'mapped'
    case 'confirm':
      return s === 'new' && order.mappingStatus === 'mapped'
    case 'invoice':
      return s === 'confirmed' && !order.trackingNumber
    case 'shipping':
      return (s === 'preparing' || s === 'confirmed') && !!order.trackingNumber
    case 'done':
      return s === 'shipped' || s === 'delivering' || s === 'delivered'
    default:
      return true
  }
}

const DEFAULT_PAGE_SIZE = 50

function getOrderMarketplaceDisplayName(order: typeof orders.$inferSelect): string | null {
  const rawData = order.rawData
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null
  const mallName = (rawData as { mallName?: unknown }).mallName
  if (typeof mallName !== 'string') return null
  const trimmed = mallName.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getOrderHistoricalClaimStatuses(order: typeof orders.$inferSelect): string[] {
  const rawData = order.rawData
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return []
  const rows = (rawData as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return []

  const statuses = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const raw = (row as { raw?: unknown }).raw
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const status = (raw as { 주문상태?: unknown }).주문상태
    if (typeof status !== 'string') continue
    const trimmed = status.trim()
    if (/^(취소|반품|교환)/.test(trimmed)) statuses.add(trimmed)
  }
  return [...statuses].sort((a, b) => a.localeCompare(b, 'ko'))
}

/**
 * Build WHERE clause conditions from filters.
 * Exported for testability.
 */
export function buildOrderWhereClause(filters: OrderFilters): SQL[] {
  const conditions: SQL[] = []

  if (filters.userId) {
    conditions.push(eq(orders.userId, filters.userId))
  }

  if (filters.status) {
    conditions.push(eq(orders.status, filters.status))
  }

  if (filters.marketplace) {
    conditions.push(eq(orders.marketplaceId, filters.marketplace))
  }

  if (filters.dateFrom) {
    conditions.push(gte(orders.orderedAt, new Date(filters.dateFrom)))
  }

  if (filters.dateTo) {
    conditions.push(lte(orders.orderedAt, new Date(filters.dateTo)))
  }

  if (filters.search) {
    const trimmed = filters.search.trim()
    const searchPattern = `%${trimmed}%`
    const searchField = filters.searchField ?? 'all'
    const itemExists = (condition: SQL<unknown>) => exists(
      db
        .select({ x: sql`1` })
        .from(orderItems)
        .where(and(eq(orderItems.orderId, orders.id), condition)),
    )
    const confirmedProductExists = exists(
      db
        .select({ x: sql`1` })
        .from(orderItems)
        .innerJoin(
          products,
          and(
            eq(products.userId, orders.userId),
            eq(products.internalSku, orderItems.sku),
          ),
        )
        .where(
          and(
            eq(orderItems.orderId, orders.id),
            ilike(products.name, searchPattern),
          ),
        ),
    )
    const trackingExists = exists(
      db
        .select({ x: sql`1` })
        .from(shipments)
        .where(
          and(
            eq(shipments.orderId, orders.id),
            ilike(shipments.trackingNumber, searchPattern),
          ),
        ),
    )

    const searchCondition = (() => {
      switch (searchField) {
        case 'buyerName':
          return ilike(orders.buyerName, searchPattern)
        case 'recipientName':
          return ilike(orders.recipientName, searchPattern)
        case 'marketplaceOrderId':
          return ilike(orders.marketplaceOrderId, searchPattern)
        case 'internalNo':
          return ilike(orders.internalNo, `%${trimmed.replace(/^#/, '')}%`)
        case 'sku':
          return itemExists(ilike(orderItems.sku, searchPattern))
        case 'marketplaceProductCode':
          return itemExists(ilike(orderItems.marketplaceItemId, searchPattern))
        case 'collectedProductName':
          return itemExists(ilike(orderItems.productName, searchPattern))
        case 'confirmedProductName':
          return confirmedProductExists
        case 'recipientPhone':
          return ilike(orders.recipientPhone, searchPattern)
        case 'recipientPhone2':
          return ilike(orders.recipientPhone2, searchPattern)
        case 'buyerPhone':
          return ilike(orders.buyerPhone, searchPattern)
        case 'buyerPhone2':
          return ilike(orders.buyerPhone2, searchPattern)
        case 'trackingNumber':
          return trackingExists
        case 'logisticsMessage':
          return ilike(orders.logisticsMessage, searchPattern)
        case 'all':
        default:
          return or(
            ilike(orders.marketplaceOrderId, searchPattern),
            ilike(orders.internalNo, `%${trimmed.replace(/^#/, '')}%`),
            ilike(orders.buyerName, searchPattern),
            ilike(orders.buyerPhone, searchPattern),
            ilike(orders.buyerPhone2, searchPattern),
            ilike(orders.recipientName, searchPattern),
            ilike(orders.recipientPhone, searchPattern),
            ilike(orders.recipientPhone2, searchPattern),
            ilike(orders.logisticsMessage, searchPattern),
            itemExists(ilike(orderItems.marketplaceItemId, searchPattern)),
            itemExists(ilike(orderItems.sku, searchPattern)),
            itemExists(ilike(orderItems.productName, searchPattern)),
            confirmedProductExists,
            trackingExists,
          )
      }
    })()

    if (searchCondition) conditions.push(searchCondition)
  }

  if (filters.isHeld) {
    conditions.push(eq(orders.isHeld, true))
  }

  // Phase 8 — 취소 탭 통합 필터: status='cancelled' OR claimType='cancel'
  if (filters.cancelTab) {
    conditions.push(
      or(
        eq(orders.status, 'cancelled'),
        exists(
          db
            .select({ x: sql`1` })
            .from(claims)
            .where(
              and(
                eq(claims.orderId, orders.id),
                eq(claims.claimType, 'cancel'),
              ),
            ),
        ),
      )!,
    )
  }

  return conditions
}

/** Sort column mapping */
function getSortColumn(sort?: string) {
  switch (sort) {
    case 'ordered_at':
      return orders.orderedAt
    case 'created_at':
      return orders.createdAt
    case 'total_amount':
      return orders.totalAmount
    case 'status':
      return orders.status
    case 'marketplace':
      return orders.marketplaceId
    case 'buyer_name':
      return orders.buyerName
    default:
      return orders.orderedAt
  }
}

/**
 * Get orders with filtering and pagination.
 * Returns orders with their items for the dashboard table.
 */
export async function getOrders(filters: OrderFilters = {}) {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const offset = (page - 1) * pageSize

  const conditions = buildOrderWhereClause(filters)
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const sortColumn = getSortColumn(filters.sort)
  const sortDir = filters.order === 'asc' ? asc(sortColumn) : desc(sortColumn)

  // perf: orderRows / count / mapping-lookups 는 서로 의존성이 없으므로
  // 한 wave 에서 병렬 실행한다 (이전엔 4 wave 직렬 → 2 wave 로 압축).
  const userId = filters.userId

  // userId-scoped mapping 인벤토리 (mappingStatus 계산용)
  // unstable_cache 로 60초 캐시 → 탭/페이지 전환 시 DB 안 가고 메모리에서 즉시 응답
  const userScopedPromise = userId
    ? getMappingLookupsCached(userId)
    : Promise.resolve({
        productSkus: [] as Array<{ sku: string }>,
        variantSkus: [] as Array<{ sku: string }>,
        sources: [] as Array<{
          mappingCodeId: string
          marketplaceId: string
          marketplaceProductId: string
          marketplaceOptionId: string
        }>,
        components: [] as Array<{
          mappingCodeId: string
          sku: string
          quantity: number
          productName: string | null
          optionName: string | null
          availableStock: number | null
        }>,
      })

  // orderRows + total count — claimType 분기 안에서도 두 쿼리는 같은 IDs 를 공유하므로
  // 같은 IIFE 안에서 처리하되, 외부에서는 userScopedPromise 와 병렬 실행한다.
  const ordersAndCountPromise: Promise<{
    orderRows: (typeof orders.$inferSelect)[]
    total: number
  }> = (async () => {
    if (filters.claimType) {
      const claimOrderIds = await db
        .select({ orderId: claims.orderId })
        .from(claims)
        .where(eq(claims.claimType, filters.claimType))
      const ids = claimOrderIds.map((r) => r.orderId)
      if (ids.length === 0) return { orderRows: [], total: 0 }
      const claimWhere = conditions.length > 0
        ? and(...conditions, inArray(orders.id, ids))
        : inArray(orders.id, ids)
      const [rows, countRows] = await Promise.all([
        db
          .select()
          .from(orders)
          .where(claimWhere)
          .orderBy(sortDir)
          .limit(pageSize)
          .offset(offset),
        db.select({ value: count(orders.id) }).from(orders).where(claimWhere),
      ])
      return { orderRows: rows, total: countRows[0]?.value ?? 0 }
    }
    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(whereClause)
        .orderBy(sortDir)
        .limit(pageSize)
        .offset(offset),
      db.select({ value: count() }).from(orders).where(whereClause),
    ])
    return { orderRows: rows, total: countRows[0]?.value ?? 0 }
  })()

  const [
    { orderRows, total: orderTotal },
    { productSkus, variantSkus, sources: mappingSourceRows, components: mappingComponentRows },
  ] = await Promise.all([ordersAndCountPromise, userScopedPromise])

  // Fetch items/claims/shipments/shipmentGroups in parallel.
  // Phase A 매핑 재설계: productNameMappings LEFT JOIN 제거. 확정상품명은
  // SKU ↔ products.internalSku 직접 매칭(products.name) 으로만 해석.
  const orderIds = orderRows.map((o) => o.id)
  const [itemRows, claimRows, shipmentRows, groupRows, inquiryRows] = orderIds.length > 0
    ? await Promise.all([
        db
          .select({
            id: orderItems.id,
            orderId: orderItems.orderId,
            marketplaceItemId: orderItems.marketplaceItemId,
            productName: orderItems.productName,
            optionText: orderItems.optionText,
            quantity: orderItems.quantity,
            unitPrice: orderItems.unitPrice,
            sku: orderItems.sku,
            skuMultiplier: orderItems.skuMultiplier,
            fulfillmentCode: orderItems.fulfillmentCode,
            // 확정상품명 — SKU가 products에 직접 매칭된 경우만 해석
            productInternalName: products.name,
            shippingCost: products.shippingCost,
            // 잔여 재고 — orderItems.sku ↔ inventory.sku (user 스코프)
            availableStock: inventory.availableStock,
            orderMarketplaceId: orders.marketplaceId,
            orderUserId: orders.userId,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orders.id, orderItems.orderId))
          .leftJoin(
            products,
            and(
              eq(products.userId, orders.userId),
              eq(products.internalSku, orderItems.sku),
            ),
          )
          .leftJoin(
            inventory,
            and(
              eq(inventory.userId, orders.userId),
              eq(inventory.sku, orderItems.sku),
            ),
          )
          .where(inArray(orderItems.orderId, orderIds)),
        db.select().from(claims).where(inArray(claims.orderId, orderIds)),
        db.select().from(shipments).where(inArray(shipments.orderId, orderIds)),
        db
          .select({
            orderId: shipmentGroupOrders.orderId,
            groupId: shipmentGroups.id,
            groupKey: shipmentGroups.groupKey,
          })
          .from(shipmentGroupOrders)
          .innerJoin(shipmentGroups, eq(shipmentGroupOrders.shipmentGroupId, shipmentGroups.id))
          .where(inArray(shipmentGroupOrders.orderId, orderIds)),
        listInquiriesByOrderIds(orderIds),
      ])
    : [
        [] as Array<{
          id: string
          orderId: string
          marketplaceItemId: string | null
          productName: string
          optionText: string | null
          quantity: number
          unitPrice: string
          sku: string | null
          skuMultiplier: number
          fulfillmentCode: string | null
          productInternalName: string | null
          shippingCost: string | null
          availableStock: number | null
          orderMarketplaceId: string
          orderUserId: string
        }>,
        [] as (typeof claims.$inferSelect)[],
        [] as (typeof shipments.$inferSelect)[],
        [] as { orderId: string; groupId: string; groupKey: string }[],
        [] as Awaited<ReturnType<typeof listInquiriesByOrderIds>>,
      ]

  // Phase 8 — base orderItems shape. displayName is enriched below after mapping index is built.
  const baseItems = itemRows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    marketplaceItemId: r.marketplaceItemId,
    productName: r.productName,
    optionText: r.optionText,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    sku: r.sku,
    skuMultiplier: r.skuMultiplier,
    fulfillmentCode: r.fulfillmentCode,
    orderMarketplaceId: r.orderMarketplaceId,
    // 직접 SKU 매칭 표시명. 매핑 규칙 표시명은 mappingIndex 생성 후 아래에서 채운다.
    displayName: r.productInternalName ?? null,
    shippingCost: r.shippingCost,
    availableStock: r.availableStock,
  }))

  // Phase 8 — Set of orderIds with at least one inquiry
  const inquirySet = new Set<string>()
  for (const inq of inquiryRows) {
    if (inq.orderId) inquirySet.add(inq.orderId)
  }

  const groupByOrderId = new Map<string, { groupId: string; groupKey: string }>()
  for (const g of groupRows) {
    groupByOrderId.set(g.orderId, { groupId: g.groupId, groupKey: g.groupKey })
  }

  // Map latest shipment per order
  const shipmentByOrderId = new Map<string, typeof shipments.$inferSelect>()
  for (const shipment of shipmentRows) {
    const existing = shipmentByOrderId.get(shipment.orderId)
    if (!existing || shipment.createdAt > existing.createdAt) {
      shipmentByOrderId.set(shipment.orderId, shipment)
    }
  }

  // Map first claim (most recent by requestedAt) per order — need id/status for inline CS actions
  type ClaimSummary = { id: string; claimType: string; claimStatus: string; reason: string | null }
  const claimByOrderId = new Map<string, ClaimSummary>()
  for (const claim of claimRows) {
    const existing = claimByOrderId.get(claim.orderId)
    if (!existing || claim.requestedAt > (claimRows.find((c) => c.id === existing.id)?.requestedAt ?? new Date(0))) {
      claimByOrderId.set(claim.orderId, {
        id: claim.id,
        claimType: claim.claimType,
        claimStatus: claim.claimStatus,
        reason: claim.reason,
      })
    }
  }

  // perf: productSkus / variantSkus / mappingSources 는 위쪽 userScopedPromise 에서 이미 받아왔다.
  // Phase C — mappingStatus 판정 (사방넷 품번/단품 분리):
  //   1) 단품매핑(`option_id != ''`) 정확일치 → 매핑됨
  //   2) 품번매핑(`option_id = ''`) 정확/prefix 일치 → 매핑됨
  //   3) fallback: orderItems.sku ∈ products.internalSku ∪ productVariants.sku
  const skuSet = new Set<string>()
  for (const p of productSkus) skuSet.add(p.sku)
  for (const v of variantSkus) skuSet.add(v.sku)

  const mappingIndex = buildMappingIndex(
    mappingSourceRows.map<MappingSource>((s) => ({
      marketplaceId: s.marketplaceId,
      marketplaceProductId: s.marketplaceProductId,
      marketplaceOptionId: s.marketplaceOptionId,
      ref: s.mappingCodeId,
    })),
  )

  const componentsByCode = new Map<string, typeof mappingComponentRows>()
  for (const component of mappingComponentRows) {
    const list = componentsByCode.get(component.mappingCodeId) ?? []
    list.push(component)
    componentsByCode.set(component.mappingCodeId, list)
  }

  const getMappedItemInfo = (
    marketplaceId: string,
    marketplaceItemId: string | null,
    orderQuantity: number,
  ): {
    displayName: string
    quantity: number
    sku: string | null
    availableStock: number | null
  } | null => {
    if (!marketplaceItemId) return null
    const mappingCodeId = lookupMappingRef(mappingIndex, marketplaceId, marketplaceItemId)
    if (!mappingCodeId) return null
    const components = componentsByCode.get(mappingCodeId) ?? []
    if (components.length === 0) return null
    const displayName = components
      .map((component) => {
        const name = component.productName ?? component.sku
        const option = component.optionName ? ` ${component.optionName}` : ''
        return `${name}${option}`
      })
      .join(' + ')
    const mappedQuantity = components.reduce(
      (sum, component) => sum + (component.quantity * orderQuantity),
      0,
    )
    return {
      displayName,
      quantity: mappedQuantity > 0 ? mappedQuantity : orderQuantity,
      sku: components.length === 1 ? components[0].sku : null,
      availableStock: components.length === 1 ? components[0].availableStock : null,
    }
  }

  const items = baseItems.map((item) => {
    const mapped = getMappedItemInfo(item.orderMarketplaceId, item.marketplaceItemId, item.quantity)
    if (!mapped) return item
    return {
      ...item,
      displayName: mapped.displayName,
      quantity: mapped.quantity,
      sku: mapped.sku ?? item.sku,
      availableStock: mapped.availableStock ?? item.availableStock,
    }
  })

  const getMappingStatus = (orderMarketplaceId: string, orderItems: typeof items): MappingStatus => {
    if (orderItems.length === 0) return 'unmapped'
    let mappedCount = 0
    for (const item of orderItems) {
      const hasSourceMatch = item.marketplaceItemId
        ? lookupMappingRef(mappingIndex, orderMarketplaceId, item.marketplaceItemId) !== null
        : false
      const hasSkuMatch = item.sku ? skuSet.has(item.sku.trim()) : false
      if (hasSourceMatch || hasSkuMatch) mappedCount++
    }
    if (mappedCount === orderItems.length) return 'mapped'
    if (mappedCount === 0) return 'unmapped'
    return 'partial'
  }

  // Group items by orderId — Phase 8 shape (orderItems base + displayName + shippingCost)
  type ItemRow = typeof items[number]
  const itemsByOrderId = new Map<string, ItemRow[]>()
  for (const item of items) {
    const existing = itemsByOrderId.get(item.orderId) ?? []
    existing.push(item)
    itemsByOrderId.set(item.orderId, existing)
  }

  // Combine orders with items, claim, shipment info, and mapping status
  let ordersWithItems = orderRows.map((order) => {
    const shipment = shipmentByOrderId.get(order.id)
    const orderItemsData = itemsByOrderId.get(order.id) ?? []
    const claim = claimByOrderId.get(order.id) ?? null
    const group = groupByOrderId.get(order.id) ?? null
    return {
      ...order,
      claimType: claim?.claimType ?? null,
      claimId: claim?.id ?? null,
      claimStatus: claim?.claimStatus ?? null,
      claimReason: claim?.reason ?? null,
      invoiceStatus: shipment?.uploadStatus ?? null,
      trackingNumber: shipment?.trackingNumber ?? null,
      carrierName: shipment?.carrierName ?? null,
      shipmentGroupId: group?.groupId ?? null,
      shipmentGroupKey: group?.groupKey ?? null,
      // Phase 8 — inquiry indicator source for orders UI (SC-03)
      hasInquiries: inquirySet.has(order.id),
      items: orderItemsData,
      mappingStatus: getMappingStatus(order.marketplaceId, orderItemsData),
      marketplaceDisplayName: getOrderMarketplaceDisplayName(order),
      historicalClaimStatuses: getOrderHistoricalClaimStatuses(order),
    }
  })

  // Apply mapping filter (post-fetch since it requires computed status)
  if (filters.mapping === 'mapped') {
    ordersWithItems = ordersWithItems.filter((o) => o.mappingStatus === 'mapped')
  } else if (filters.mapping === 'unmapped') {
    ordersWithItems = ordersWithItems.filter((o) => o.mappingStatus !== 'mapped')
  }

  // Apply workflow stage filter (post-fetch, computed)
  if (filters.stage) {
    ordersWithItems = ordersWithItems.filter((o) => matchStage(o, filters.stage!))
  }

  // 확정대기 단계: 같은 합포장 그룹 주문이 인접하도록 정렬 (그룹 있는 것 먼저)
  if (filters.stage === 'confirm') {
    ordersWithItems.sort((a, b) => {
      const aG = a.shipmentGroupId
      const bG = b.shipmentGroupId
      if (aG && !bG) return -1
      if (!aG && bG) return 1
      if (aG && bG && aG !== bG) return aG < bG ? -1 : 1
      return 0
    })
  }

  // perf: total count 는 ordersAndCountPromise 에서 같이 가져왔다.
  return {
    orders: ordersWithItems,
    total: orderTotal,
  }
}

/**
 * Get single order by ID with items and claims.
 */
export async function getOrderById(id: string, userId?: string) {
  const whereClause = userId
    ? and(eq(orders.id, id), eq(orders.userId, userId))
    : eq(orders.id, id)

  const [order] = await db.select().from(orders).where(whereClause)

  if (!order) return null

  const [orderItemRows, claimRows, memoRows, shipmentRows, scanLogRows] = await Promise.all([
    // 수집상품명(productName) + 확정상품명 동시 반환
    // Phase A 매핑 재설계: 확정상품명은 SKU ↔ products.internalSku 직접 매칭(products.name) 만 사용.
    db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        marketplaceItemId: orderItems.marketplaceItemId,
        productName: orderItems.productName,
        optionText: orderItems.optionText,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        sku: orderItems.sku,
        skuMultiplier: orderItems.skuMultiplier,
        fulfillmentCode: orderItems.fulfillmentCode,
        productInternalName: products.name,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .leftJoin(
        products,
        and(
          eq(products.userId, orders.userId),
          eq(products.internalSku, orderItems.sku),
        ),
      )
      .where(eq(orderItems.orderId, id)),
    db.select().from(claims).where(eq(claims.orderId, id)),
    db
      .select()
      .from(orderMemos)
      .where(eq(orderMemos.orderId, id))
      .orderBy(desc(orderMemos.createdAt)),
    db.select().from(shipments).where(eq(shipments.orderId, id)),
    // 바코드 스캔 이력 — 최신순. 상세 페이지의 '바코드 스캔 여부' 섹션 표시용.
    db
      .select()
      .from(scanLogs)
      .where(eq(scanLogs.orderId, id))
      .orderBy(desc(scanLogs.scannedAt)),
  ])

  const latestShipment =
    shipmentRows.length > 0
      ? shipmentRows.reduce((prev, cur) =>
          cur.createdAt > prev.createdAt ? cur : prev,
        )
      : null

  // 확정상품명 fallback chain
  const items = orderItemRows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    marketplaceItemId: r.marketplaceItemId,
    productName: r.productName,
    optionText: r.optionText,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    sku: r.sku,
    skuMultiplier: r.skuMultiplier,
    fulfillmentCode: r.fulfillmentCode,
    displayName: r.productInternalName ?? null,
  }))

  return {
    ...order,
    items,
    claims: claimRows,
    memos: memoRows,
    shipment: latestShipment,
    /** 모든 송장 — 송장정보 섹션에서 다중 송장(분할배송)도 표시할 수 있도록 */
    shipments: shipmentRows,
    /** 바코드 스캔 이력 — 최신순 */
    scanLogs: scanLogRows,
  }
}

/**
 * 주문 출고 시 실제 차감될 재고 미리보기.
 *
 * Phase C 매핑코드 시스템:
 *   1) (marketplaceId, marketplaceItemId) 가 mapping_sources 에 있으면
 *      mapping_components 의 SKU + 수량으로 전개 (단품=1, 세트=N).
 *   2) 매칭 없으면 fallback: orderItems.sku 직접 사용.
 *   3) 같은 SKU 가 여러 줄에서 나오면 합산.
 */
export interface StockDeductionPreviewRow {
  sku: string
  productName: string | null
  requiredQty: number
  totalStock: number | null
  availableStock: number | null
  sufficient: boolean
  isBundleComponent: boolean
  sourceItems: Array<{ productName: string; optionText: string | null; orderQty: number }>
}

export async function getStockDeductionPreview(
  orderId: string,
  userId: string,
): Promise<StockDeductionPreviewRow[]> {
  const rows = await db
    .select({
      sku: orderItems.sku,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      quantity: orderItems.quantity,
      skuMultiplier: orderItems.skuMultiplier,
      marketplaceItemId: orderItems.marketplaceItemId,
      orderMarketplaceId: orders.marketplaceId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.orderId, orderId),
        eq(orders.userId, userId),
      ),
    )

  if (rows.length === 0) return []

  // 사방넷 품번/단품 매핑 — sources + components 한 번에 join.
  const mappingRows = await db
    .select({
      mappingCodeId: mappingSources.mappingCodeId,
      marketplaceId: mappingSources.marketplaceId,
      marketplaceProductId: mappingSources.marketplaceProductId,
      marketplaceOptionId: mappingSources.marketplaceOptionId,
      componentSku: mappingComponents.sku,
      componentQuantity: mappingComponents.quantity,
    })
    .from(mappingSources)
    .innerJoin(mappingComponents, eq(mappingComponents.mappingCodeId, mappingSources.mappingCodeId))
    .where(eq(mappingSources.userId, userId))

  // mappingCodeId 별로 components 모아두기
  const componentsByCode = new Map<string, Array<{ sku: string; quantity: number }>>()
  for (const m of mappingRows) {
    const list = componentsByCode.get(m.mappingCodeId) ?? []
    if (!list.some((c) => c.sku === m.componentSku && c.quantity === m.componentQuantity)) {
      list.push({ sku: m.componentSku, quantity: m.componentQuantity })
    }
    componentsByCode.set(m.mappingCodeId, list)
  }

  // sources index 구성 (ref = mappingCodeId)
  const sourcesForIndex: MappingSource[] = []
  const seenSrc = new Set<string>()
  for (const m of mappingRows) {
    const key = `${m.marketplaceId}:${m.marketplaceProductId}:${m.marketplaceOptionId}`
    if (seenSrc.has(key)) continue
    seenSrc.add(key)
    sourcesForIndex.push({
      marketplaceId: m.marketplaceId,
      marketplaceProductId: m.marketplaceProductId,
      marketplaceOptionId: m.marketplaceOptionId,
      ref: m.mappingCodeId,
    })
  }
  const mappingIndex = buildMappingIndex(sourcesForIndex)

  // Accumulator: sku → { requiredQty, sourceItems, isBundleComponent }
  const acc = new Map<
    string,
    {
      requiredQty: number
      sourceItems: Array<{ productName: string; optionText: string | null; orderQty: number }>
      isBundleComponent: boolean
    }
  >()
  const addToAcc = (
    sku: string,
    qty: number,
    src: { productName: string; optionText: string | null; orderQty: number },
    isBundle: boolean,
  ) => {
    const cur = acc.get(sku) ?? { requiredQty: 0, sourceItems: [], isBundleComponent: false }
    cur.requiredQty += qty
    cur.sourceItems.push(src)
    cur.isBundleComponent = cur.isBundleComponent || isBundle
    acc.set(sku, cur)
  }

  for (const row of rows) {
    const orderQty = row.quantity * (row.skuMultiplier ?? 1)
    const mappingCodeId = row.marketplaceItemId
      ? lookupMappingRef(mappingIndex, row.orderMarketplaceId, row.marketplaceItemId)
      : null
    const components = mappingCodeId ? componentsByCode.get(mappingCodeId) : null
    const src = {
      productName: row.productName ?? '',
      optionText: row.optionText,
      orderQty,
    }

    if (components && components.length > 0) {
      const isBundle = components.length > 1
      for (const c of components) {
        addToAcc(c.sku, orderQty * c.quantity, src, isBundle)
      }
    } else if (row.sku) {
      addToAcc(row.sku, orderQty, src, false)
    }
    // else: 매핑도 없고 sku 도 없음 → preview 에서 제외
  }

  const skus = Array.from(acc.keys())
  if (skus.length === 0) return []

  const invRows = await db
    .select({
      sku: inventory.sku,
      productName: inventory.productName,
      totalStock: inventory.totalStock,
      availableStock: inventory.availableStock,
    })
    .from(inventory)
    .where(and(eq(inventory.userId, userId), inArray(inventory.sku, skus)))

  const invMap = new Map(invRows.map((r) => [r.sku, r]))

  return skus.map((sku) => {
    const { requiredQty, sourceItems, isBundleComponent } = acc.get(sku)!
    const inv = invMap.get(sku)
    return {
      sku,
      productName: inv?.productName ?? null,
      requiredQty,
      totalStock: inv?.totalStock ?? null,
      availableStock: inv?.availableStock ?? null,
      sufficient: inv ? (inv.availableStock ?? 0) >= requiredQty : false,
      isBundleComponent,
      sourceItems,
    }
  })
}

/**
 * Phase 8 — Dashboard 9탭 summary counts.
 * Three focused queries (per-status group, per-claimType distinct group,
 * cancelTab distinct OR) so each tab badge is exact at SQL level.
 *
 * - Status counts: `groupBy(orders.status)` (single GROUP BY scan)
 * - Claim counts: `countDistinct(claims.orderId)` per claimType
 * - cancelTabCount: `countDistinct(orders.id)` WHERE status='cancelled' OR has cancel claim
 *
 * All scoped by userId (RLS pattern + perf).
 */
/**
 * Cached entry-point. 호출자는 `getOrderStats(userId)` 그대로 쓰면 30초 캐시 히트.
 */
export function getOrderStats(userId: string): Promise<OrderStats> {
  return getOrderStatsCached(userId)
}

async function getOrderStatsImpl(userId: string): Promise<OrderStats> {
  const [statusRows, claimRows, cancelTabRows, totalRow, heldRow] = await Promise.all([
    db
      .select({ status: orders.status, value: count() })
      .from(orders)
      .where(eq(orders.userId, userId))
      .groupBy(orders.status),
    db
      .select({ claimType: claims.claimType, value: countDistinct(claims.orderId) })
      .from(claims)
      .innerJoin(orders, eq(orders.id, claims.orderId))
      .where(eq(orders.userId, userId))
      .groupBy(claims.claimType),
    db
      .select({ value: countDistinct(orders.id) })
      .from(orders)
      .leftJoin(
        claims,
        and(eq(claims.orderId, orders.id), eq(claims.claimType, 'cancel')),
      )
      .where(
        and(
          eq(orders.userId, userId),
          or(eq(orders.status, 'cancelled'), isNotNull(claims.id)),
        ),
      ),
    db.select({ value: count() }).from(orders).where(eq(orders.userId, userId)),
    db
      .select({ value: count() })
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.isHeld, true))),
  ])

  const byStatus: Record<string, number> = {}
  for (const row of statusRows) byStatus[row.status] = row.value

  const byClaim: Record<string, number> = {}
  for (const row of claimRows) byClaim[row.claimType] = row.value

  const cancelTabCount = cancelTabRows[0]?.value ?? 0

  return {
    new: byStatus.new ?? 0,
    confirmed: byStatus.confirmed ?? 0,
    preparing: byStatus.preparing ?? 0,
    ready: byStatus.ready ?? 0,
    shipped: byStatus.shipped ?? 0,
    delivering: byStatus.delivering ?? 0,
    delivered: byStatus.delivered ?? 0,
    cancelled: byStatus.cancelled ?? 0,
    claimCancel: byClaim.cancel ?? 0,
    claimExchange: byClaim.exchange ?? 0,
    claimReturn: byClaim.return ?? 0,
    cancelTabCount,
    // legacy/aux fields — kept for backward compatibility with older callers
    total: totalRow[0]?.value ?? 0,
    held: heldRow[0]?.value ?? 0,
    cancel: byClaim.cancel ?? 0,
    return: byClaim.return ?? 0,
    exchange: byClaim.exchange ?? 0,
    newCount: byStatus.new ?? 0,
  }
}

/**
 * Get order count for pagination without fetching all data.
 */
export async function getOrderCount(
  filters: Omit<OrderFilters, 'page' | 'pageSize'> = {},
) {
  const conditions = buildOrderWhereClause(filters)
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const [result] = await db
    .select({ value: count() })
    .from(orders)
    .where(whereClause)

  return result?.value ?? 0
}
