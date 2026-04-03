/**
 * Order queries with server-side filtering and pagination.
 *
 * Used by the dashboard to list, filter, and paginate orders.
 * All queries run server-side (offset/limit pagination acceptable for admin tool).
 */

import { db } from '@/lib/db'
import { orders, orderItems, claims } from '@/lib/db/schema'
import { eq, and, or, ilike, gte, lte, desc, asc, sql, count } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { OrderFilters } from './types'

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

  // Fetch orders
  const orderRows = await db
    .select()
    .from(orders)
    .where(whereClause)
    .orderBy(sortDir)
    .limit(pageSize)
    .offset(offset)

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

  // Group items by orderId
  const itemsByOrderId = new Map<string, (typeof orderItems.$inferSelect)[]>()
  for (const item of items) {
    const existing = itemsByOrderId.get(item.orderId) ?? []
    existing.push(item)
    itemsByOrderId.set(item.orderId, existing)
  }

  // Combine orders with items
  const ordersWithItems = orderRows.map((order) => ({
    ...order,
    items: itemsByOrderId.get(order.id) ?? [],
  }))

  // Get total count
  const [countResult] = await db
    .select({ value: count() })
    .from(orders)
    .where(whereClause)

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
