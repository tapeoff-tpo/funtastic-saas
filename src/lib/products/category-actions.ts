'use server'

/**
 * Category mapping server actions.
 *
 * Provides create/update/delete operations for internal-to-marketplace
 * category mappings. Uses upsert to prevent duplicate mappings per
 * user + internalCategory + marketplace combination.
 */

import { db } from '@/lib/db'
import { categoryMappings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

type ActionResult = { success: true } | { success: false; error: string }

interface CategoryMappingInput {
  internalCategory: string
  marketplaceId: string
  marketplaceCategoryId: string
  marketplaceCategoryName?: string
}

/**
 * Save (upsert) a category mapping.
 * If a mapping already exists for this user + internalCategory + marketplace,
 * it updates the marketplace category ID and name.
 */
export async function saveCategoryMapping(
  userId: string,
  input: CategoryMappingInput,
): Promise<ActionResult> {
  try {
    await db
      .insert(categoryMappings)
      .values({
        userId,
        internalCategory: input.internalCategory,
        marketplaceId: input.marketplaceId,
        marketplaceCategoryId: input.marketplaceCategoryId,
        marketplaceCategoryName: input.marketplaceCategoryName ?? null,
      })
      .onConflictDoUpdate({
        target: [
          categoryMappings.userId,
          categoryMappings.internalCategory,
          categoryMappings.marketplaceId,
        ],
        set: {
          marketplaceCategoryId: input.marketplaceCategoryId,
          marketplaceCategoryName: input.marketplaceCategoryName ?? null,
          updatedAt: new Date(),
        },
      })

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error saving category mapping'
    return { success: false, error: message }
  }
}

/**
 * Delete a category mapping by ID.
 */
export async function deleteCategoryMapping(
  mappingId: string,
): Promise<ActionResult> {
  try {
    const [deleted] = await db
      .delete(categoryMappings)
      .where(eq(categoryMappings.id, mappingId))
      .returning({ id: categoryMappings.id })

    if (!deleted) {
      return { success: false, error: 'Category mapping not found' }
    }

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error deleting category mapping'
    return { success: false, error: message }
  }
}

/**
 * Save multiple category mappings at once (batch setup).
 * Each mapping is upserted individually within a transaction.
 */
export async function bulkSaveCategoryMappings(
  userId: string,
  mappings: CategoryMappingInput[],
): Promise<ActionResult> {
  if (mappings.length === 0) {
    return { success: true }
  }

  try {
    await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      for (const input of mappings) {
        await tx
          .insert(categoryMappings)
          .values({
            userId,
            internalCategory: input.internalCategory,
            marketplaceId: input.marketplaceId,
            marketplaceCategoryId: input.marketplaceCategoryId,
            marketplaceCategoryName: input.marketplaceCategoryName ?? null,
          })
          .onConflictDoUpdate({
            target: [
              categoryMappings.userId,
              categoryMappings.internalCategory,
              categoryMappings.marketplaceId,
            ],
            set: {
              marketplaceCategoryId: input.marketplaceCategoryId,
              marketplaceCategoryName: input.marketplaceCategoryName ?? null,
              updatedAt: new Date(),
            },
          })
      }
    })

    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error in bulk save'
    return { success: false, error: message }
  }
}
