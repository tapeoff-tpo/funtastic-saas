/**
 * Order queries with server-side filtering and pagination.
 *
 * Used by the dashboard to list, filter, and paginate orders.
 * All queries run server-side (offset/limit pagination acceptable for admin tool).
 */

import { db } from '@/lib/db'
import { orders, orderItems, claims, shipments, orderMemos, productNameMappings, productOptionMappings, products, productVariants, productBundleItems, inventory } from '@/lib/db/schema'
import { eq, and, or, ilike, gte, lte, desc, asc, sql, count, inArray, isNotNull } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { OrderFilters, MappingStatus, OrderStage } from './types'

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
    const searchPattern = `%${filters.search}%`
    conditions.push(
      or(
        ilike(orders.buyerName, searchPattern),
        ilike(orders.marketplaceOrderId, searchPattern),
        ilike(orders.recipientName, searchPattern),
      )!,
    )
  }

  if (filters.isHeld) {
    conditions.push(eq(orders.isHeld, true))
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

  // When filtering by claimType, find matching order IDs first
  let orderRows: (typeof orders.$inferSelect)[]
  if (filters.claimType) {
    const claimOrderIds = await db
      .select({ orderId: claims.orderId })
      .from(claims)
      .where(eq(claims.claimType, filters.claimType))
    const ids = claimOrderIds.map((r) => r.orderId)
    if (ids.length === 0) {
      orderRows = []
    } else {
      const claimWhere = conditions.length > 0
        ? and(...conditions, inArray(orders.id, ids))
        : inArray(orders.id, ids)
      orderRows = await db
        .select()
        .from(orders)
        .where(claimWhere)
        .orderBy(sortDir)
        .limit(pageSize)
        .offset(offset)
    }
  } else {
    orderRows = await db
      .select()
      .from(orders)
      .where(whereClause)
      .orderBy(sortDir)
      .limit(pageSize)
      .offset(offset)
  }

  // Fetch items/claims/shipments in parallel
  const orderIds = orderRows.map((o) => o.id)
  const [items, claimRows, shipmentRows] = orderIds.length > 0
    ? await Promise.all([
        db.select().from(orderItems).where(sql`${orderItems.orderId} IN ${orderIds}`),
        db.select().from(claims).where(sql`${claims.orderId} IN ${orderIds}`),
        db.select().from(shipments).where(sql`${shipments.orderId} IN ${orderIds}`),
      ])
    : [[] as (typeof orderItems.$inferSelect)[], [] as (typeof claims.$inferSelect)[], [] as (typeof shipments.$inferSelect)[]]

  // Map latest shipment per order
  const shipmentByOrderId = new Map<string, typeof shipments.$inferSelect>()
  for (const shipment of shipmentRows) {
    const existing = shipmentByOrderId.get(shipment.orderId)
    if (!existing || shipment.createdAt > existing.createdAt) {
      shipmentByOrderId.set(shipment.orderId, shipment)
    }
  }

  // Group items by orderId
  const itemsByOrderId = new Map<string, (typeof orderItems.$inferSelect)[]>()
  for (const item of items) {
    const existing = itemsByOrderId.get(item.orderId) ?? []
    existing.push(item)
    itemsByOrderId.set(item.orderId, existing)
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

  // Load mapping lookups for mapping status determination (parallel)
  const userId = filters.userId ?? orderRows[0]?.userId
  const [nameMappings, optionMappings, productSkus, variantSkus] = userId
    ? await Promise.all([
        db.select({ marketplaceId: productNameMappings.marketplaceId, marketplaceName: productNameMappings.marketplaceName })
          .from(productNameMappings)
          .where(eq(productNameMappings.userId, userId)),
        db.select({ marketplaceId: productOptionMappings.marketplaceId, marketplaceName: productOptionMappings.marketplaceName, optionText: productOptionMappings.optionText })
          .from(productOptionMappings)
          .where(eq(productOptionMappings.userId, userId)),
        db.select({ sku: products.internalSku })
          .from(products)
          .where(eq(products.userId, userId)),
        db.select({ sku: productVariants.sku })
          .from(productVariants)
          .innerJoin(products, eq(productVariants.productId, products.id))
          .where(eq(products.userId, userId)),
      ])
    : [[], [], [], []]

  const nameKeys = new Set(nameMappings.map((m) => `${m.marketplaceId}::${m.marketplaceName}`))
  const optionKeys = new Set(optionMappings.map((m) => `${m.marketplaceId}::${m.marketplaceName}::${m.optionText}`))
  const skuSet = new Set<string>()
  for (const p of productSkus) skuSet.add(p.sku)
  for (const v of variantSkus) skuSet.add(v.sku)

  const getMappingStatus = (orderMarketplaceId: string, orderItems: typeof items): MappingStatus => {
    if (orderItems.length === 0) return 'unmapped'
    let mappedCount = 0
    for (const item of orderItems) {
      const hasNameMapping = nameKeys.has(`${orderMarketplaceId}::${item.productName}`)
      const hasSkuMatch = item.sku ? skuSet.has(item.sku.trim()) : false
      const optText = item.optionText?.trim() ?? ''
      const hasOptionMapping = optionKeys.has(`${orderMarketplaceId}::${item.productName}::${optText}`)
      if (hasNameMapping || hasSkuMatch || hasOptionMapping) mappedCount++
    }
    if (mappedCount === orderItems.length) return 'mapped'
    if (mappedCount === 0) return 'unmapped'
    return 'partial'
  }

  // Combine orders with items, claim, shipment info, and mapping status
  let ordersWithItems = orderRows.map((order) => {
    const shipment = shipmentByOrderId.get(order.id)
    const orderItemsData = itemsByOrderId.get(order.id) ?? []
    const claim = claimByOrderId.get(order.id) ?? null
    return {
      ...order,
      claimType: claim?.claimType ?? null,
      claimId: claim?.id ?? null,
      claimStatus: claim?.claimStatus ?? null,
      claimReason: claim?.reason ?? null,
      invoiceStatus: shipment?.uploadStatus ?? null,
      trackingNumber: shipment?.trackingNumber ?? null,
      carrierName: shipment?.carrierName ?? null,
      items: orderItemsData,
      mappingStatus: getMappingStatus(order.marketplaceId, orderItemsData),
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

  // Get total count
  let countResult: { value: number } | undefined
  if (filters.claimType) {
    const claimOrderIds = await db
      .select({ orderId: claims.orderId })
      .from(claims)
      .where(eq(claims.claimType, filters.claimType))
    const ids = claimOrderIds.map((r) => r.orderId)
    if (ids.length === 0) {
      countResult = { value: 0 }
    } else {
      const countConditions = buildOrderWhereClause(filters)
      const countWhere = countConditions.length > 0
        ? and(...countConditions, inArray(orders.id, ids))
        : inArray(orders.id, ids)
      ;[countResult] = await db
        .select({ value: count(orders.id) })
        .from(orders)
        .where(countWhere)
    }
  } else {
    ;[countResult] = await db
      .select({ value: count() })
      .from(orders)
      .where(whereClause)
  }

  return {
    orders: ordersWithItems,
    total: countResult?.value ?? 0,
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

  const [orderItemRows, claimRows, memoRows, shipmentRows] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, id)),
    db.select().from(claims).where(eq(claims.orderId, id)),
    db
      .select()
      .from(orderMemos)
      .where(eq(orderMemos.orderId, id))
      .orderBy(desc(orderMemos.createdAt)),
    db.select().from(shipments).where(eq(shipments.orderId, id)),
  ])

  const latestShipment =
    shipmentRows.length > 0
      ? shipmentRows.reduce((prev, cur) =>
          cur.createdAt > prev.createdAt ? cur : prev,
        )
      : null

  return {
    ...order,
    items: orderItemRows,
    claims: claimRows,
    memos: memoRows,
    shipment: latestShipment,
  }
}

/**
 * 주문 출고 시 실제 차감될 재고 미리보기.
 * - 각 order item의 sku를 bundle 정의로 확장 (구성품 × (componentQty × orderQty))
 * - 단품 SKU는 그대로 (orderQty)
 * - 현재 재고(totalStock/availableStock)와 상품명 포함
 * - 같은 component SKU가 여러 줄에서 나오면 합산
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
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.orderId, orderId),
        eq(orders.userId, userId),
        isNotNull(orderItems.sku),
      ),
    )

  if (rows.length === 0) return []

  const mappedSkus = Array.from(new Set(rows.map((r) => r.sku!).filter(Boolean)))

  const bundleRows = mappedSkus.length
    ? await db
        .select({
          bundleSku: productBundleItems.bundleSku,
          componentSku: productBundleItems.componentSku,
          quantity: productBundleItems.quantity,
        })
        .from(productBundleItems)
        .where(
          and(
            eq(productBundleItems.userId, userId),
            inArray(productBundleItems.bundleSku, mappedSkus),
          ),
        )
    : []

  const bundleMap = new Map<string, Array<{ componentSku: string; quantity: number }>>()
  for (const b of bundleRows) {
    const list = bundleMap.get(b.bundleSku) ?? []
    list.push({ componentSku: b.componentSku, quantity: b.quantity })
    bundleMap.set(b.bundleSku, list)
  }

  // Accumulator: sku → { requiredQty, isBundleComponent, sourceItems }
  const acc = new Map<
    string,
    {
      requiredQty: number
      isBundleComponent: boolean
      sourceItems: Array<{ productName: string; optionText: string | null; orderQty: number }>
    }
  >()

  for (const row of rows) {
    const sku = row.sku!
    const orderQty = row.quantity * (row.skuMultiplier ?? 1)
    const components = bundleMap.get(sku)

    if (components && components.length > 0) {
      for (const c of components) {
        const current = acc.get(c.componentSku) ?? {
          requiredQty: 0,
          isBundleComponent: true,
          sourceItems: [],
        }
        current.requiredQty += c.quantity * orderQty
        current.isBundleComponent = true
        current.sourceItems.push({
          productName: row.productName,
          optionText: row.optionText,
          orderQty,
        })
        acc.set(c.componentSku, current)
      }
    } else {
      const current = acc.get(sku) ?? {
        requiredQty: 0,
        isBundleComponent: false,
        sourceItems: [],
      }
      current.requiredQty += orderQty
      current.sourceItems.push({
        productName: row.productName,
        optionText: row.optionText,
        orderQty,
      })
      acc.set(sku, current)
    }
  }

  const skus = Array.from(acc.keys())
  const invRows = skus.length
    ? await db
        .select({
          sku: inventory.sku,
          productName: inventory.productName,
          totalStock: inventory.totalStock,
          availableStock: inventory.availableStock,
        })
        .from(inventory)
        .where(and(eq(inventory.userId, userId), inArray(inventory.sku, skus)))
    : []

  const invMap = new Map(invRows.map((r) => [r.sku, r]))

  return skus.map((sku) => {
    const { requiredQty, isBundleComponent, sourceItems } = acc.get(sku)!
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

export interface OrderStats {
  total: number
  cancel: number
  return: number
  exchange: number
  held: number
  // Workflow flow counts (by orders.status)
  newCount: number
  confirmed: number
  preparing: number
  shipped: number
}

/**
 * Dashboard-style summary counts for a user's orders.
 * All scoped by userId. Parallelized COUNT queries for tabs + workflow diagram.
 */
export async function getOrderStats(userId: string): Promise<OrderStats> {
  const [totalRow, claimRows, heldRow, statusRows] = await Promise.all([
    db.select({ value: count() }).from(orders).where(eq(orders.userId, userId)),
    db
      .select({ claimType: claims.claimType, value: count() })
      .from(claims)
      .innerJoin(orders, eq(orders.id, claims.orderId))
      .where(eq(orders.userId, userId))
      .groupBy(claims.claimType),
    db
      .select({ value: count() })
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.isHeld, true))),
    db
      .select({ status: orders.status, value: count() })
      .from(orders)
      .where(eq(orders.userId, userId))
      .groupBy(orders.status),
  ])

  const byClaimType: Record<string, number> = {}
  for (const row of claimRows) byClaimType[row.claimType] = row.value

  const byStatus: Record<string, number> = {}
  for (const row of statusRows) byStatus[row.status] = row.value

  return {
    total: totalRow[0]?.value ?? 0,
    cancel: byClaimType.cancel ?? 0,
    return: byClaimType.return ?? 0,
    exchange: byClaimType.exchange ?? 0,
    held: heldRow[0]?.value ?? 0,
    newCount: byStatus.new ?? 0,
    confirmed: byStatus.confirmed ?? 0,
    preparing: byStatus.preparing ?? 0,
    shipped: (byStatus.shipped ?? 0) + (byStatus.delivering ?? 0) + (byStatus.delivered ?? 0),
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
