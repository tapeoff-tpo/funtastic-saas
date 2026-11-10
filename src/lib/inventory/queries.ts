import { db } from '@/lib/db'
import { cache } from 'react'
import { inventory, inventoryHistory, orders } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, asc, count, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { InventoryFilters } from './types'
import { getSkuOutgoingMetrics } from '@/lib/purchasing/items'
import { isHistoricalInventoryMonth, inventoryPeriodDate } from './period'
import { inventoryMonthEndStock } from './snapshot-schema'

const DEFAULT_PAGE_SIZE = 50

export function buildWarehouseSelectionHaving(warehouseZone: string | undefined, column: AnyColumn = inventory.warehouseZone) {
  if (!warehouseZone) return undefined
  return sql`BOOL_OR(${column} = ${warehouseZone})`
}

export const getInventoryList = cache(async function getInventoryList(
  userId: string,
  filters: InventoryFilters = {},
) {
  const historicalMonth = isHistoricalInventoryMonth(filters.referenceMonth)
  const stock = historicalMonth ? inventoryMonthEndStock : inventory
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const offset = (page - 1) * pageSize
  const conditions: SQL[] = [eq(stock.userId, userId)]

  if (historicalMonth) conditions.push(eq(inventoryMonthEndStock.referenceMonth, filters.referenceMonth!))
  if (filters.search) {
    const pattern = `%${filters.search}%`
    conditions.push(or(
      ilike(stock.sku, pattern),
      ilike(stock.productName, pattern),
      ilike(stock.optionName, pattern),
    )!)
  }
  if (filters.productCode) conditions.push(ilike(stock.sku, `%${filters.productCode}%`))
  if (filters.optionCode) {
    const pattern = `%${filters.optionCode}%`
    conditions.push(or(ilike(stock.optionName, pattern), ilike(stock.sku, pattern))!)
  }
  const whereClause = and(...conditions)
  const purchasingStockSql = sql<number>`COALESCE(SUM(CASE WHEN ${stock.warehouseZone} IN ('1창고', '쿠팡창고', '쿠팡', '2창고') THEN ${stock.availableStock} ELSE 0 END), 0)::int`
  const havingConditions = [
    buildWarehouseSelectionHaving(filters.warehouseZone, stock.warehouseZone),
    typeof filters.maxStock === 'number' && Number.isFinite(filters.maxStock)
      ? sql`${purchasingStockSql} <= ${filters.maxStock}`
      : undefined,
  ].filter((condition): condition is SQL => condition !== undefined)
  const havingClause = havingConditions.length > 0 ? and(...havingConditions) : undefined
  const sortColumn = (() => {
    switch (filters.sort) {
      case 'sku': return stock.sku
      case 'productName': return sql`MAX(${stock.productName})`
      case 'warehouseZone': return sql`STRING_AGG(DISTINCT COALESCE(${stock.warehouseZone}, ''), '/' ORDER BY COALESCE(${stock.warehouseZone}, ''))`
      case 'sectorCode': return sql`STRING_AGG(DISTINCT COALESCE(${stock.sectorCode}, ''), '/' ORDER BY COALESCE(${stock.sectorCode}, ''))`
      case 'totalStock':
      case 'availableStock': return purchasingStockSql
      case 'updatedAt': return sql`MAX(${stock.updatedAt})`
      default: return stock.sku
    }
  })()
  const sortDirection = filters.order === 'desc' ? desc : asc
  const primaryOrderSql = sql`CASE ${stock.warehouseZone} WHEN '1창고' THEN 0 WHEN '쿠팡창고' THEN 1 WHEN '쿠팡' THEN 1 WHEN '2창고' THEN 2 ELSE 3 END`

  const pageQuery = db.select({
    id: sql<string>`(ARRAY_AGG(${stock.id} ORDER BY ${primaryOrderSql}, ${stock.createdAt} ASC))[1]`,
    inventoryId: sql<string>`(ARRAY_AGG(${stock.id} ORDER BY ${primaryOrderSql}, ${stock.createdAt} ASC))[1]`,
    sku: stock.sku,
    productName: sql<string>`MAX(${stock.productName})`,
    optionName: sql<string | null>`MAX(${stock.optionName})`,
    warehouseZone: sql<string | null>`NULLIF(STRING_AGG(DISTINCT COALESCE(${stock.warehouseZone}, ''), '/' ORDER BY COALESCE(${stock.warehouseZone}, '')), '')`,
    sectorCode: sql<string | null>`NULLIF(STRING_AGG(DISTINCT COALESCE(${stock.sectorCode}, ''), '/' ORDER BY COALESCE(${stock.sectorCode}, '')), '')`,
    availableStock: purchasingStockSql,
    oneWarehouseStock: sql<number>`COALESCE(SUM(CASE WHEN ${stock.warehouseZone} = '1창고' THEN ${stock.availableStock} ELSE 0 END), 0)::int`,
    coupangWarehouseStock: sql<number>`COALESCE(SUM(CASE WHEN ${stock.warehouseZone} IN ('쿠팡창고', '쿠팡') THEN ${stock.availableStock} ELSE 0 END), 0)::int`,
    twoWarehouseStock: sql<number>`COALESCE(SUM(CASE WHEN ${stock.warehouseZone} = '2창고' THEN ${stock.availableStock} ELSE 0 END), 0)::int`,
    primaryTotalStock: sql<number>`(ARRAY_AGG(${stock.totalStock} ORDER BY ${primaryOrderSql}, ${stock.createdAt} ASC))[1]::int`,
    updatedAt: sql<Date>`MAX(${stock.updatedAt})`,
  }).from(stock).where(whereClause).groupBy(stock.sku).$dynamic()

  const countQuery = db.select({ sku: stock.sku })
    .from(stock).where(whereClause).groupBy(stock.sku).$dynamic()
  if (havingClause) {
    pageQuery.having(havingClause)
    countQuery.having(havingClause)
  }

  const [pageRows, [countRow]] = await Promise.all([
    pageQuery.orderBy(sortDirection(sortColumn)).limit(pageSize).offset(offset),
    db.select({ total: count() }).from(countQuery.as('matching_inventory_skus')),
  ])
  const referenceDate = inventoryPeriodDate(filters.referenceMonth)
  const outgoingMetricsBySku = pageRows.length > 0
    ? await getSkuOutgoingMetrics(userId, pageRows.map((row) => row.sku), referenceDate, historicalMonth ? 'historical-summary' : 'summary')
    : new Map()

  return {
    items: pageRows.map((row) => {
      const outgoingMetrics = outgoingMetricsBySku.get(row.sku)
      return {
        ...row,
        currentMonthOutgoing: outgoingMetrics?.currentMonthOutgoing ?? 0,
        threeMonthAverageOutgoing: outgoingMetrics?.threeMonthAverageOutgoing ?? 0,
      }
    }),
    total: Number(countRow?.total ?? 0),
  }
})

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
