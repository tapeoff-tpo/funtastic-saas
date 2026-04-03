'use server'

/**
 * Product UI server actions.
 *
 * Bridges the product management UI to backend business logic.
 * Each action verifies user authentication before delegating.
 */

import { createClient } from '@/lib/supabase/server'
import { getProducts, getProductById } from './queries'
import { createProduct, updateProduct, deleteProduct } from './actions'
import { syncProductToMarketplace, syncProductToAllMarketplaces } from './sync'
import { reverseCollectProducts, type ReverseCollectResult } from './reverse-collect'
import { getCategoryMappings, getInternalCategories } from './categories'
import { saveCategoryMapping, deleteCategoryMapping } from './category-actions'
import type { ProductFilters, ProductFormData, ProductListItem, ProductDetail, CategoryMapping } from './types'

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

async function requireUser(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return user.id
}

/**
 * Get paginated product list with filters.
 */
export async function getProductsAction(
  filters: ProductFilters = {},
): Promise<{ items: ProductListItem[]; total: number }> {
  const userId = await requireUser()
  return getProducts(userId, filters)
}

/**
 * Get a single product with variants and marketplace links.
 */
export async function getProductByIdAction(
  productId: string,
): Promise<ProductDetail | null> {
  await requireUser()
  return getProductById(productId)
}

/**
 * Create a new product with variants.
 */
export async function createProductAction(
  formData: ProductFormData,
): Promise<ActionResult<{ productId: string }>> {
  const userId = await requireUser()
  return createProduct(userId, formData)
}

/**
 * Update an existing product.
 */
export async function updateProductAction(
  productId: string,
  formData: ProductFormData,
): Promise<ActionResult<void>> {
  const userId = await requireUser()
  return updateProduct(userId, productId, formData)
}

/**
 * Soft delete a product.
 */
export async function deleteProductAction(
  productId: string,
): Promise<ActionResult<void>> {
  const userId = await requireUser()
  return deleteProduct(userId, productId)
}

/**
 * Sync a product to a specific marketplace.
 */
export async function syncProductAction(
  productId: string,
  marketplaceId: string,
  connectionId: string,
): Promise<ActionResult<{ marketplaceProductId?: string }>> {
  await requireUser()
  const result = await syncProductToMarketplace(productId, marketplaceId, connectionId)
  if (result.success) {
    return { success: true, data: { marketplaceProductId: result.marketplaceProductId } }
  }
  return { success: false, error: result.error ?? 'Sync failed' }
}

/**
 * Sync a product to all connected marketplaces.
 */
export async function syncAllAction(
  productId: string,
): Promise<ActionResult<{ results: Array<{ marketplaceId: string; success: boolean; error?: string }> }>> {
  await requireUser()
  const results = await syncProductToAllMarketplaces(productId)
  return {
    success: true,
    data: {
      results: results.map((r) => ({
        marketplaceId: r.marketplaceId,
        success: r.success,
        error: r.error,
      })),
    },
  }
}

/**
 * Reverse collect products from a connected marketplace.
 */
export async function reverseCollectAction(
  connectionId: string,
  marketplaceId: string,
): Promise<ActionResult<ReverseCollectResult>> {
  const userId = await requireUser()
  try {
    const result = await reverseCollectProducts(userId, connectionId, marketplaceId)
    return { success: true, data: result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reverse collection failed'
    return { success: false, error: message }
  }
}

/**
 * Get category mappings for the current user.
 */
export async function getCategoryMappingsAction(
  marketplaceId?: string,
): Promise<CategoryMapping[]> {
  const userId = await requireUser()
  return getCategoryMappings(userId, marketplaceId)
}

/**
 * Get distinct internal categories used by user's products.
 */
export async function getInternalCategoriesAction(): Promise<string[]> {
  const userId = await requireUser()
  return getInternalCategories(userId)
}

/**
 * Save a category mapping (create or update).
 */
export async function saveCategoryMappingAction(input: {
  internalCategory: string
  marketplaceId: string
  marketplaceCategoryId: string
  marketplaceCategoryName?: string
}): Promise<ActionResult<void>> {
  const userId = await requireUser()
  const result = await saveCategoryMapping(userId, input)
  if (result.success) {
    return { success: true, data: undefined }
  }
  return { success: false, error: 'error' in result ? result.error : 'Failed to save mapping' }
}

/**
 * Delete a category mapping.
 */
export async function deleteCategoryMappingAction(
  mappingId: string,
): Promise<ActionResult<void>> {
  await requireUser()
  const result = await deleteCategoryMapping(mappingId)
  if (result.success) {
    return { success: true, data: undefined }
  }
  return { success: false, error: 'error' in result ? result.error : 'Failed to delete mapping' }
}
