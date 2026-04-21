/**
 * Order queries with server-side filtering and pagination.
 *
 * Used by the dashboard to list, filter, and paginate orders.
 * All queries run server-side (offset/limit pagination acceptable for admin tool).
 */

import { db } from '@/lib/db'
import { orders, orderItems, claims, shipments, productNameMappings, products, productVariants } from '@/lib/db/schema'
import { eq, and, or, ilike, gte, lte, desc, asc, sql, count, inArray } from 'drizzle-orm'
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

  // Fetch items for these orders
  const orderIds = orderRows.map((o) => o.id)
  let items: (typeof orderItems.$inferSelect)[] = []
  if (orderIds.length > 0) {
    items = await db
      .select()
      .from(orderItems)
      .where(
        sql`${orderItems.orderId} IN ${orderIds}`,
      )
  }

  // Fetch claims for these orders to get claimType
  let claimRows: (typeof claims.$inferSelect)[] = []
  if (orderIds.length > 0) {
    claimRows = await db
      .select()
      .from(claims)
      .where(
        sql`${claims.orderId} IN ${orderIds}`,
      )
  }

  // Fetch shipments for these orders to get invoice status
  let shipmentRows: (typeof shipments.$inferSelect)[] = []
  if (orderIds.length > 0) {
    shipmentRows = await db
      .select()
      .from(shipments)
      .where(
        sql`${shipments.orderId} IN ${orderIds}`,
      )
  }

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

  // Map first claim type per order
  const claimTypeByOrderId = new Map<string, string>()
  for (const claim of claimRows) {
    if (!claimTypeByOrderId.has(claim.orderId)) {
      claimTypeByOrderId.set(claim.orderId, claim.claimType)
    }
  }

  // Load mapping lookups for mapping status determination
  const userId = orderRows[0]?.userId
  const nameMappings = userId
    ? await db
        .select({ marketplaceId: productNameMappings.marketplaceId, marketplaceName: productNameMappings.marketplaceName })
        .from(productNameMappings)
        .where(eq(productNameMappings.userId, userId))
    : []
  const productSkus = userId
    ? await db
        .select({ sku: products.internalSku })
        .from(products)
        .where(eq(products.userId, userId))
    : []
  const variantSkus = userId
    ? await db
        .select({ sku: productVariants.sku })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(eq(products.userId, userId))
    : []

  const nameKeys = new Set(nameMappings.map((m) => `${m.marketplaceId}::${m.marketplaceName}`))
  const skuSet = new Set<string>()
  for (const p of productSkus) skuSet.add(p.sku)
  for (const v of variantSkus) skuSet.add(v.sku)

  const getMappingStatus = (orderMarketplaceId: string, orderItems: typeof items): MappingStatus => {
    if (orderItems.length === 0) return 'unmapped'
    let mappedCount = 0
    for (const item of orderItems) {
      const hasNameMapping = nameKeys.has(`${orderMarketplaceId}::${item.productName}`)
      const hasSkuMatch = item.sku ? skuSet.has(item.sku.trim()) : false
      if (hasNameMapping || hasSkuMatch) mappedCount++
    }
    if (mappedCount === orderItems.length) return 'mapped'
    if (mappedCount === 0) return 'unmapped'
    return 'partial'
  }

  // Combine orders with items, claim type, shipment info, and mapping status
  let ordersWithItems = orderRows.map((order) => {
    const shipment = shipmentByOrderId.get(order.id)
    const orderItemsData = itemsByOrderId.get(order.id) ?? []
    return {
      ...order,
      claimType: claimTypeByOrderId.get(order.id) ?? null,
      invoiceStatus: shipment?.uploadStatus ?? null,
      trackingNumber: shipment?.trackingNumber ?? null,
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
export async function getOrderById(id: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))

  if (!order) return null

  const orderItemRows = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id))

  const claimRows = await db
    .select()
    .from(claims)
    .where(eq(claims.orderId, id))

  return {
    ...order,
    items: orderItemRows,
    claims: claimRows,
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
