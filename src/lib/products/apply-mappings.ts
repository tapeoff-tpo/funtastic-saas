/**
 * Apply product name mappings to order items.
 *
 * Two-tier matching:
 * 1. SKU 자동 매핑: orderItem.sku → products.internalSku / productVariants.sku
 * 2. 수동 매핑: (marketplaceId, productName) → productNameMappings.displayName
 *
 * 수동 매핑이 있으면 우선 적용, 없으면 SKU 매칭 시도.
 */

import { db } from '@/lib/db'
import { productNameMappings, products, productVariants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export interface OrderItemLike {
  productName: string
  marketplaceId?: string
  sku?: string | null
  [key: string]: unknown
}

export interface MappingEntry {
  displayName: string
  pickingLocation: string | null
}

/**
 * Load manual name mappings for a user.
 * Key: `${marketplaceId}::${marketplaceName}`
 */
export async function loadMappingLookup(
  userId: string,
): Promise<Map<string, MappingEntry>> {
  const rows = await db
    .select({
      marketplaceId: productNameMappings.marketplaceId,
      marketplaceName: productNameMappings.marketplaceName,
      displayName: productNameMappings.displayName,
      pickingLocation: productNameMappings.pickingLocation,
    })
    .from(productNameMappings)
    .where(eq(productNameMappings.userId, userId))

  const map = new Map<string, MappingEntry>()
  for (const row of rows) {
    map.set(`${row.marketplaceId}::${row.marketplaceName}`, {
      displayName: row.displayName,
      pickingLocation: row.pickingLocation,
    })
  }
  return map
}

/**
 * Load SKU-based product lookup for a user.
 * Key: sku (internalSku or variant sku)
 * Value: { displayName (product name), pickingLocation (warehouseLocation) }
 */
export async function loadSkuLookup(
  userId: string,
): Promise<Map<string, MappingEntry>> {
  const map = new Map<string, MappingEntry>()

  // 1. products.internalSku → product name + warehouseLocation
  const productRows = await db
    .select({
      internalSku: products.internalSku,
      name: products.name,
      warehouseLocation: products.warehouseLocation,
    })
    .from(products)
    .where(eq(products.userId, userId))

  for (const row of productRows) {
    map.set(row.internalSku, {
      displayName: row.name,
      pickingLocation: row.warehouseLocation,
    })
  }

  // 2. productVariants.sku → parent product name + warehouseLocation
  const variantRows = await db
    .select({
      sku: productVariants.sku,
      productName: products.name,
      warehouseLocation: products.warehouseLocation,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(products.userId, userId))

  for (const row of variantRows) {
    if (!map.has(row.sku)) {
      map.set(row.sku, {
        displayName: row.productName,
        pickingLocation: row.warehouseLocation,
      })
    }
  }

  return map
}

/**
 * Apply mappings: 수동 매핑 우선, 없으면 SKU 자동 매핑.
 */
export function applyMappings<T extends OrderItemLike>(
  items: T[],
  nameLookup: Map<string, MappingEntry>,
  skuLookup: Map<string, MappingEntry>,
  marketplaceId?: string,
): (T & { pickingLocation?: string | null })[] {
  return items.map((item) => {
    // 1. 수동 매핑 (marketplaceId + productName)
    const mid = item.marketplaceId ?? marketplaceId ?? ''
    const nameKey = `${mid}::${item.productName}`
    const nameEntry = nameLookup.get(nameKey)
    if (nameEntry) {
      return { ...item, productName: nameEntry.displayName, pickingLocation: nameEntry.pickingLocation }
    }

    // 2. SKU 자동 매핑
    const sku = typeof item.sku === 'string' ? item.sku.trim() : null
    if (sku) {
      const skuEntry = skuLookup.get(sku)
      if (skuEntry) {
        return { ...item, productName: skuEntry.displayName, pickingLocation: skuEntry.pickingLocation }
      }
    }

    // 매칭 없음 — 원본 유지
    return item
  })
}

/**
 * Convenience: load all lookups and apply in one call.
 */
export async function applyProductNameMappings<T extends OrderItemLike>(
  userId: string,
  items: T[],
  marketplaceId?: string,
): Promise<(T & { pickingLocation?: string | null })[]> {
  const [nameLookup, skuLookup] = await Promise.all([
    loadMappingLookup(userId),
    loadSkuLookup(userId),
  ])
  return applyMappings(items, nameLookup, skuLookup, marketplaceId)
}
