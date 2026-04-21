/**
 * Inventory queries — driven by products table as source of truth.
 *
 * Inventory records are joined to products by sku ↔ internalSku.
 * Orphan inventory records (no matching product) are excluded.
 */

import { db } from '@/lib/db'
import { inventory, inventoryHistory, products } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, asc, count, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { InventoryFilters } from './types'

const DEFAULT_PAGE_SIZE = 50

/**
 * Get paginated inventory list joined with products.
 * Products table is the source of truth for 상품코드/상품명/창고위치.
 */
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

  // Sort column — from products or inventory
  const sortColumn = (() => {
    switch (filters.sort) {
      case 'sku': return products.internalSku
      case 'productName': return products.name
      case 'warehouseZone': return sql`COALESCE(${inventory.warehouseZone}, '')`
      case 'sectorCode': return sql`COALESCE(${products.warehouseLocation}, ${inventory.sectorCode}, '')`
      case 'totalStock': return sql`COALESCE(${inventory.totalStock}, 0)`
      case 'reservedStock': return sql`COALESCE(${inventory.reservedStock}, 0)`
      case 'availableStock': return sql`COALESCE(${inventory.availableStock}, 0)`
      case 'updatedAt': return products.updatedAt
      default: return products.createdAt
    }
  })()

  const sortDirection = filters.order === 'asc' ? asc : desc

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        // Use products as source of truth
        id: sql<string>`COALESCE(${inventory.id}, ${products.id})`,
        sku: products.internalSku,
        productName: products.name,
        warehouseZone: inventory.warehouseZone,
        sectorCode: sql<string | null>`COALESCE(${products.warehouseLocation}, ${inventory.sectorCode})`,
        totalStock: sql<number>`COALESCE(${inventory.totalStock}, 0)::int`,
        reservedStock: sql<number>`COALESCE(${inventory.reservedStock}, 0)::int`,
        availableStock: sql<number>`COALESCE(${inventory.availableStock}, 0)::int`,
        createdAt: products.createdAt,
        updatedAt: sql<Date>`COALESCE(${inventory.updatedAt}, ${products.updatedAt})`,
        userId: products.userId,
      })
      .from(products)
      .leftJoin(
        inventory,
        and(eq(inventory.sku, products.internalSku), eq(inventory.userId, products.userId)),
      )
      .where(whereClause)
      .orderBy(sortDirection(sortColumn))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(products)
      .leftJoin(
        inventory,
        and(eq(inventory.sku, products.internalSku), eq(inventory.userId, products.userId)),
      )
      .where(whereClause),
  ])

  return { items: rows, total }
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

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(inventoryHistory)
      .where(eq(inventoryHistory.inventoryId, inventoryId))
      .orderBy(desc(inventoryHistory.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(inventoryHistory)
      .where(eq(inventoryHistory.inventoryId, inventoryId)),
  ])

  return { items, total }
}
