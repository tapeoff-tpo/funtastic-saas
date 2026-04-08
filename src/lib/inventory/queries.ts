/**
 * Inventory queries with server-side filtering and pagination.
 *
 * Used by the inventory management UI to list, search, and view
 * inventory records and their audit history.
 */

import { db } from '@/lib/db'
import { inventory, inventoryHistory } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, asc, count } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { InventoryFilters } from './types'

const DEFAULT_PAGE_SIZE = 50

/**
 * Get paginated inventory list with search and sorting.
 */
export async function getInventoryList(
  userId: string,
  filters: InventoryFilters = {},
) {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const offset = (page - 1) * pageSize

  const conditions: SQL[] = [eq(inventory.userId, userId)]

  if (filters.search) {
    const searchPattern = `%${filters.search}%`
    conditions.push(
      or(
        ilike(inventory.sku, searchPattern),
        ilike(inventory.productName, searchPattern),
      )!,
    )
  }

  if (filters.warehouseZone) {
    conditions.push(eq(inventory.warehouseZone, filters.warehouseZone))
  }

  const whereClause = and(...conditions)

  // Determine sort column
  const sortColumn = (() => {
    switch (filters.sort) {
      case 'sku': return inventory.sku
      case 'productName': return inventory.productName
      case 'warehouseZone': return inventory.warehouseZone
      case 'sectorCode': return inventory.sectorCode
      case 'totalStock': return inventory.totalStock
      case 'reservedStock': return inventory.reservedStock
      case 'availableStock': return inventory.availableStock
      case 'updatedAt': return inventory.updatedAt
      default: return inventory.createdAt
    }
  })()

  const sortDirection = filters.order === 'asc' ? asc : desc

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(inventory)
      .where(whereClause)
      .orderBy(sortDirection(sortColumn))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(inventory)
      .where(whereClause),
  ])

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
