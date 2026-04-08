/**
 * Apply product name mappings to order items.
 *
 * When exporting shipping labels / 송장, we replace each order item's
 * marketplace productName with the user's internal displayName.
 *
 * Usage (server-side, inside an export route or action):
 *
 *   const items = await applyProductNameMappings(userId, orderItems)
 *   // items[n].productName is now the internal display name if mapped
 */

import { db } from '@/lib/db'
import { productNameMappings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export interface OrderItemLike {
  productName: string
  marketplaceId?: string
  [key: string]: unknown
}

export interface MappingEntry {
  displayName: string
  pickingLocation: string | null
}

/**
 * Load all mappings for a user and return a lookup Map.
 * Key: `${marketplaceId}::${marketplaceName}`
 * Value: { displayName, pickingLocation }
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
 * Apply mappings in-place: replace productName with displayName where a
 * mapping exists for (marketplaceId, productName). Also spreads pickingLocation
 * onto the returned item.
 *
 * Returns a new array with the productName and pickingLocation fields updated.
 * Items without a mapping keep their original productName and have no pickingLocation.
 */
export function applyMappings<T extends OrderItemLike>(
  items: T[],
  lookup: Map<string, MappingEntry>,
  marketplaceId?: string,
): (T & { pickingLocation?: string | null })[] {
  return items.map((item) => {
    const mid = item.marketplaceId ?? marketplaceId ?? ''
    const key = `${mid}::${item.productName}`
    const entry = lookup.get(key)
    if (!entry) return item
    return { ...item, productName: entry.displayName, pickingLocation: entry.pickingLocation }
  })
}

/**
 * Convenience: load mappings and apply them in one call.
 */
export async function applyProductNameMappings<T extends OrderItemLike>(
  userId: string,
  items: T[],
  marketplaceId?: string,
): Promise<(T & { pickingLocation?: string | null })[]> {
  const lookup = await loadMappingLookup(userId)
  return applyMappings(items, lookup, marketplaceId)
}
