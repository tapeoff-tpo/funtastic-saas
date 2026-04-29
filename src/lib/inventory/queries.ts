/**
 * Inventory queries — driven by products table as source of truth.
 *
 * Performance strategy: paginate first, enrich after.
 * 1. Get 50 product rows (fast — no history join)
 * 2. Aggregate inventoryHistory only for those 50 rows
 * 3. Merge results in JS
 *
 * This avoids GROUP BY + inventoryHistory scan on all 3000+ rows.
 */

import { db } from '@/lib/db'
import { inventory, inventoryHistory, orders, products } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, asc, count, ne, sql, inArray } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { InventoryFilters } from './types'

const DEFAULT_PAGE_SIZE = 50

export async function getInventoryList(
  userId: string,
  filters: InventoryFilters = {},
) {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const offset = (page - 1) * pageSize

  const conditions: SQL[] = [
    eq(products.userId, userId),
    ne(products.status, 'deleted'),
    // 재고관리 대상으로 체크된 상품만 노출 (migration 023)
    eq(products.manageInventory, true),
  ]

  if (filters.search) {
    const searchPattern = `%${filters.search}%`
    conditions.push(
      or(
        ilike(products.internalSku, searchPattern),
        ilike(products.name, searchPattern),
      )!,
    )
  }

  if (filters.warehouseZone) {
    conditions.push(eq(inventory.warehouseZone, filters.warehouseZone))
  }

  const whereClause = and(...conditions)

  const sortColumn = (() => {
    switch (filters.sort) {
      case 'sku': return products.internalSku
      case 'productName': return products.name
      case 'warehouseZone': return sql`COALESCE(${inventory.warehouseZone}, '')`
      case 'sectorCode': return sql`COALESCE(${inventory.sectorCode}, '')`
      case 'totalStock': return sql`COALESCE(${inventory.totalStock}, 0)`
      case 'reservedStock': return sql`COALESCE(${inventory.reservedStock}, 0)`
      case 'availableStock': return sql`COALESCE(${inventory.availableStock}, 0)`
      case 'updatedAt': return products.updatedAt
      default: return products.createdAt
    }
  })()

  const sortDirection = filters.order === 'asc' ? asc : desc

  // ── Step 1: paginate products (no history join — fast) ──────────────────
  const [pageRows, [{ total }]] = await Promise.all([
    db
      .select({
        id: sql<string>`COALESCE(${inventory.id}::text, ${products.id}::text)`,
        inventoryId: inventory.id,
        productId: products.id,
        sku: products.internalSku,
        productName: products.name,
        optionName: inventory.optionName,
        packagingUnit: inventory.packagingUnit,
        warehouseZone: inventory.warehouseZone,
        sectorCode: inventory.sectorCode,
        totalStock: sql<number>`COALESCE(${inventory.totalStock}, 0)::int`,
        reservedStock: sql<number>`COALESCE(${inventory.reservedStock}, 0)::int`,
        availableStock: sql<number>`COALESCE(${inventory.availableStock}, 0)::int`,
        shippingCost: products.shippingCost,
        createdAt: products.createdAt,
        updatedAt: sql<Date>`COALESCE(${inventory.updatedAt}, ${products.updatedAt})`,
        userId: products.userId,
      })
      .from(products)
      .leftJoin(inventory, and(eq(inventory.sku, products.internalSku), eq(inventory.userId, products.userId)))
      .where(whereClause)
      .orderBy(sortDirection(sortColumn))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(products)
      .leftJoin(inventory, and(eq(inventory.sku, products.internalSku), eq(inventory.userId, products.userId)))
      .where(whereClause),
  ])

  // ── Step 2: aggregate history only for this page's inventory IDs ────────
  const inventoryIds = pageRows.map((r) => r.inventoryId).filter((id): id is string => id !== null)

  const historyMap = new Map<string, {
    monthlyIncoming: number
    monthlyOutgoing: number
    lastIncomingAt: Date | null
    lastOutgoingAt: Date | null
  }>()

  if (inventoryIds.length > 0) {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

    const stats = await db
      .select({
        inventoryId: inventoryHistory.inventoryId,
        monthlyIncoming: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryHistory.adjustmentReason} = 'incoming' AND ${inventoryHistory.createdAt} >= ${monthStart}::timestamptz AND ${inventoryHistory.createdAt} < ${monthEnd}::timestamptz THEN ${inventoryHistory.delta} ELSE 0 END), 0)::int`,
        monthlyOutgoing: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryHistory.adjustmentReason} = 'order_ship' AND ${inventoryHistory.createdAt} >= ${monthStart}::timestamptz AND ${inventoryHistory.createdAt} < ${monthEnd}::timestamptz THEN ABS(${inventoryHistory.delta}) ELSE 0 END), 0)::int`,
        lastIncomingAt: sql<Date | null>`MAX(CASE WHEN ${inventoryHistory.adjustmentReason} = 'incoming' THEN ${inventoryHistory.createdAt} END)`,
        lastOutgoingAt: sql<Date | null>`MAX(CASE WHEN ${inventoryHistory.adjustmentReason} = 'order_ship' THEN ${inventoryHistory.createdAt} END)`,
      })
      .from(inventoryHistory)
      .where(inArray(inventoryHistory.inventoryId, inventoryIds))
      .groupBy(inventoryHistory.inventoryId)

    for (const s of stats) {
      historyMap.set(s.inventoryId, {
        monthlyIncoming: s.monthlyIncoming,
        monthlyOutgoing: s.monthlyOutgoing,
        lastIncomingAt: s.lastIncomingAt,
        lastOutgoingAt: s.lastOutgoingAt,
      })
    }
  }

  // ── Step 3: merge ───────────────────────────────────────────────────────
  const items = pageRows.map((row) => {
    const hist = row.inventoryId ? historyMap.get(row.inventoryId) : undefined
    return {
      ...row,
      monthlyIncoming: hist?.monthlyIncoming ?? 0,
      monthlyOutgoing: hist?.monthlyOutgoing ?? 0,
      lastIncomingAt: hist?.lastIncomingAt ?? null,
      lastOutgoingAt: hist?.lastOutgoingAt ?? null,
    }
  })

  return { items, total }
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
