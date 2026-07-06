import { db } from '@/lib/db'
import { inventory, inventoryHistory, orders, products } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, asc, count, sql, inArray } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { InventoryFilters } from './types'
import { resolveOutgoingMetrics } from '@/lib/purchasing/items'

const DEFAULT_PAGE_SIZE = 50

export async function getInventoryList(
  userId: string,
  filters: InventoryFilters = {},
) {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const offset = (page - 1) * pageSize
  const conditions: SQL[] = [eq(inventory.userId, userId)]

  if (filters.search) {
    const pattern = `%${filters.search}%`
    conditions.push(or(
      ilike(inventory.sku, pattern),
      ilike(inventory.productName, pattern),
      ilike(inventory.optionName, pattern),
    )!)
  }
  if (filters.productCode) conditions.push(ilike(inventory.sku, `%${filters.productCode}%`))
  if (filters.optionCode) {
    const pattern = `%${filters.optionCode}%`
    conditions.push(or(ilike(inventory.optionName, pattern), ilike(inventory.sku, pattern))!)
  }
  if (filters.warehouseZone) conditions.push(eq(inventory.warehouseZone, filters.warehouseZone))

  const whereClause = and(...conditions)
  const purchasingStockSql = sql<number>`COALESCE(SUM(CASE WHEN ${inventory.warehouseZone} IN ('1창고', '쿠팡창고', '쿠팡', '2창고') THEN ${inventory.availableStock} ELSE 0 END), 0)::int`
  const havingClause = typeof filters.maxStock === 'number' && Number.isFinite(filters.maxStock)
    ? sql`${purchasingStockSql} <= ${filters.maxStock}`
    : undefined
  const sortColumn = (() => {
    switch (filters.sort) {
      case 'sku': return inventory.sku
      case 'productName': return sql`MAX(${inventory.productName})`
      case 'warehouseZone': return sql`STRING_AGG(DISTINCT COALESCE(${inventory.warehouseZone}, ''), '/' ORDER BY COALESCE(${inventory.warehouseZone}, ''))`
      case 'totalStock':
      case 'availableStock': return purchasingStockSql
      case 'updatedAt': return sql`MAX(${inventory.updatedAt})`
      default: return inventory.sku
    }
  })()
  const sortDirection = filters.order === 'desc' ? desc : asc
  const primaryOrderSql = sql`CASE ${inventory.warehouseZone} WHEN '1창고' THEN 0 WHEN '쿠팡창고' THEN 1 WHEN '쿠팡' THEN 1 WHEN '2창고' THEN 2 ELSE 3 END`

  const pageQuery = db.select({
    id: sql<string>`(ARRAY_AGG(${inventory.id} ORDER BY ${primaryOrderSql}, ${inventory.createdAt} ASC))[1]`,
    inventoryId: sql<string>`(ARRAY_AGG(${inventory.id} ORDER BY ${primaryOrderSql}, ${inventory.createdAt} ASC))[1]`,
    sku: inventory.sku,
    productName: sql<string>`MAX(${inventory.productName})`,
    optionName: sql<string | null>`MAX(${inventory.optionName})`,
    warehouseZone: sql<string | null>`NULLIF(STRING_AGG(DISTINCT COALESCE(${inventory.warehouseZone}, ''), '/' ORDER BY COALESCE(${inventory.warehouseZone}, '')), '')`,
    availableStock: purchasingStockSql,
    oneWarehouseStock: sql<number>`COALESCE(SUM(CASE WHEN ${inventory.warehouseZone} = '1창고' THEN ${inventory.availableStock} ELSE 0 END), 0)::int`,
    coupangWarehouseStock: sql<number>`COALESCE(SUM(CASE WHEN ${inventory.warehouseZone} IN ('쿠팡창고', '쿠팡') THEN ${inventory.availableStock} ELSE 0 END), 0)::int`,
    twoWarehouseStock: sql<number>`COALESCE(SUM(CASE WHEN ${inventory.warehouseZone} = '2창고' THEN ${inventory.availableStock} ELSE 0 END), 0)::int`,
    primaryTotalStock: sql<number>`(ARRAY_AGG(${inventory.totalStock} ORDER BY ${primaryOrderSql}, ${inventory.createdAt} ASC))[1]::int`,
    updatedAt: sql<Date>`MAX(${inventory.updatedAt})`,
  }).from(inventory).where(whereClause).groupBy(inventory.sku).$dynamic()

  const countQuery = db.select({ sku: inventory.sku })
    .from(inventory).where(whereClause).groupBy(inventory.sku).$dynamic()
  if (havingClause) {
    pageQuery.having(havingClause)
    countQuery.having(havingClause)
  }

  const [pageRows, countRows] = await Promise.all([
    pageQuery.orderBy(sortDirection(sortColumn)).limit(pageSize).offset(offset),
    countQuery,
  ])
  const metricRows = pageRows.length > 0
    ? await db.select({ internalSku: products.internalSku, metadata: products.metadata })
        .from(products).where(and(
          eq(products.userId, userId),
          inArray(products.internalSku, pageRows.map((row) => row.sku)),
        ))
    : []
  const outgoingMetricsBySku = new Map(metricRows.map((row) => [
    row.internalSku,
    resolveOutgoingMetrics(row.metadata, {
      currentMonthOutgoing: 0,
      threeMonthAverageOutgoing: 0,
    }),
  ]))

  return {
    items: pageRows.map((row) => {
      const outgoingMetrics = outgoingMetricsBySku.get(row.sku)
      return {
        ...row,
        currentMonthOutgoing: outgoingMetrics?.currentMonthOutgoing ?? 0,
        threeMonthAverageOutgoing: outgoingMetrics?.threeMonthAverageOutgoing ?? 0,
      }
    }),
    total: countRows.length,
  }
}

/**
 * Get a single inventory record by SKU for a user.
 */
export async function getInventoryBySku(userId: string, sku: string) {
  const [record] = await db
    .select()
    .from(inventory)
    .where(and(eq(inventory.userId, userId), eq(inventory.sku, sku)))
    .limit(1)

  return record ?? null
}

/**
 * Get paginated audit history for a specific inventory item.
 */
export async function getInventoryHistory(
  inventoryId: string,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
) {
  const offset = (page - 1) * pageSize

  const [rawItems, [{ total }]] = await Promise.all([
    db
      .select({
        id: inventoryHistory.id,
        inventoryId: inventoryHistory.inventoryId,
        userId: inventoryHistory.userId,
        createdAt: inventoryHistory.createdAt,
        adjustmentReason: inventoryHistory.adjustmentReason,
        delta: inventoryHistory.delta,
        previousTotal: inventoryHistory.previousTotal,
        newTotal: inventoryHistory.newTotal,
        note: inventoryHistory.note,
        orderId: inventoryHistory.orderId,
        // 사용자에게 보여줄 8자리 internal_no — UUID 대신 노출
        orderInternalNo: orders.internalNo,
      })
      .from(inventoryHistory)
      .leftJoin(orders, eq(orders.id, inventoryHistory.orderId))
      .where(eq(inventoryHistory.inventoryId, inventoryId))
      .orderBy(desc(inventoryHistory.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(inventoryHistory)
      .where(eq(inventoryHistory.inventoryId, inventoryId)),
  ])

  return { items: rawItems, total }
}
