/**
 * Category mapping queries.
 *
 * Provides lookups for internal-to-marketplace category mappings.
 * Each user maps their internal product categories to marketplace-specific
 * category IDs for product registration.
 */

import { db } from '@/lib/db'
import { categoryMappings, products } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { CategoryMapping } from './types'

/**
 * Get all category mappings for a user, optionally filtered by marketplace.
 */
export async function getCategoryMappings(
  userId: string,
  marketplaceId?: string,
): Promise<CategoryMapping[]> {
  const conditions: SQL[] = [eq(categoryMappings.userId, userId)]

  if (marketplaceId) {
    conditions.push(eq(categoryMappings.marketplaceId, marketplaceId))
  }

  const rows = await db
    .select()
    .from(categoryMappings)
    .where(and(...conditions))
    .orderBy(desc(categoryMappings.updatedAt))

  return rows as CategoryMapping[]
}

/**
 * Get a specific category mapping for a user, internal category, and marketplace.
 */
export async function getCategoryMapping(
  userId: string,
  internalCategory: string,
  marketplaceId: string,
): Promise<CategoryMapping | null> {
  const [row] = await db
    .select()
    .from(categoryMappings)
    .where(
      and(
        eq(categoryMappings.userId, userId),
        eq(categoryMappings.internalCategory, internalCategory),
        eq(categoryMappings.marketplaceId, marketplaceId),
      ),
    )
    .limit(1)

  return (row as CategoryMapping) ?? null
}

/**
 * Get distinct internal categories used by a user's products.
 * Returns category IDs that have been assigned to at least one product.
 */
export async function getInternalCategories(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ categoryId: products.categoryId })
    .from(products)
    .where(eq(products.userId, userId))

  return rows
    .map((r: { categoryId: string | null }) => r.categoryId)
    .filter((c: string | null): c is string => c != null)
}

/**
 * Resolve an internal category to a marketplace category ID.
 * Returns null if no mapping exists for this combination.
 */
export async function getMappedMarketplaceCategory(
  userId: string,
  internalCategory: string,
  marketplaceId: string,
): Promise<string | null> {
  const mapping = await getCategoryMapping(userId, internalCategory, marketplaceId)
  return mapping?.marketplaceCategoryId ?? null
}
