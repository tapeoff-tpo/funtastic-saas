'use server'

/**
 * Product UI server actions.
 *
 * Bridges the product management UI to backend business logic.
 * Each action verifies user authentication before delegating.
 */

import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'
import { and, eq, inArray, like, notLike } from 'drizzle-orm'
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
 * Get change logs for a product.
 */
export async function getProductChangeLogsAction(productId: string) {
  await requireUser()
  const { getProductChangeLogs } = await import('./change-log')
  return getProductChangeLogs(productId)
}

/**
 * Bulk soft-delete products by ID list.
 */
export async function bulkDeleteProductsAction(
  productIds: string[],
): Promise<ActionResult<{ deleted: number }>> {
  const userId = await requireUser()
  if (productIds.length === 0) return { success: true, data: { deleted: 0 } }

  const updated = await db
    .update(products)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(and(eq(products.userId, userId), inArray(products.id, productIds)))
    .returning({ id: products.id })

  return { success: true, data: { deleted: updated.length } }
}

/**
 * Bulk soft-delete all products matching a skuPrefix filter.
 */
export async function bulkDeleteBySkuPrefixAction(
  prefix: string,
  exclude: boolean,
): Promise<ActionResult<{ deleted: number }>> {
  const userId = await requireUser()
  if (!prefix) return { success: false, error: '접두사를 입력해주세요.' }

  const pattern = `${prefix}%`
  const skuCondition = exclude
    ? notLike(products.internalSku, pattern)
    : like(products.internalSku, pattern)

  const updated = await db
    .update(products)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(and(eq(products.userId, userId), skuCondition))
    .returning({ id: products.id })

  return { success: true, data: { deleted: updated.length } }
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

/**
 * Import products from an Excel file.
 * Delegates to parseProductExcel + bulkImportProducts when available.
 */
export async function importExcelAction(
  formData: FormData,
): Promise<ActionResult<{ created: number; updated: number; errors: string[] }>> {
  await requireUser()

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return { success: false, error: '파일이 선택되지 않았습니다.' }
  }

  // Excel import module will be wired in plan 05-04
  // For now, return a not-implemented error
  return { success: false, error: '엑셀 가져오기 기능은 준비 중입니다. (05-04 plan)' }
}
