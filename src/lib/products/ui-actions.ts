'use server'

/**
 * Product UI server actions.
 *
 * Bridges the product management UI to backend business logic.
 * Each action verifies user authentication before delegating.
 */

import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { analyticsChannelProductOverrides, inventory, products, purchaseRequestItems } from '@/lib/db/schema'
import { and, eq, inArray, like, notLike, or, sql } from 'drizzle-orm'
import { getProducts, getProductById } from './queries'
import { createProduct, updateProduct, deleteProduct, updateProductStatus } from './actions'
import { syncProductToMarketplace, syncProductToAllMarketplaces } from './sync'
import { reverseCollectProducts, type ReverseCollectResult } from './reverse-collect'
import { getCategoryMappings, getInternalCategories } from './categories'
import { saveCategoryMapping, deleteCategoryMapping } from './category-actions'
import type { ProductFilters, ProductFormData, ProductListItem, ProductDetail, CategoryMapping, ProductStatus } from './types'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

async function requireUser(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return getWorkspaceUserId(user.id)
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
  const userId = await requireUser()
  return getProductById(userId, productId)
}

export type ProductOperationsSummary = {
  totalAvailableStock: number
  zeroStockSkuCount: number
  inventorySkuCount: number
  purchaseRowCount: number
  purchaseQuantity: number
  purchaseStatuses: Array<{ status: string; count: number }>
  channelProductCount: number
  sellingChannelProductCount: number
}

/**
 * Product detail's compact operational view. Every value is read by the
 * internal SKU and active option SKUs, so it does not create a second source
 * of truth for stock, purchasing, or channel registrations.
 */
export async function getProductOperationsSummaryAction(productId: string): Promise<ProductOperationsSummary> {
  const userId = await requireUser()
  const product = await getProductById(userId, productId)
  if (!product) throw new Error('Product not found or access denied')

  const skus = Array.from(new Set([product.internalSku, ...product.variants.filter((variant) => variant.isActive).map((variant) => variant.sku)]))
  if (skus.length === 0) {
    return { totalAvailableStock: 0, zeroStockSkuCount: 0, inventorySkuCount: 0, purchaseRowCount: 0, purchaseQuantity: 0, purchaseStatuses: [], channelProductCount: 0, sellingChannelProductCount: 0 }
  }

  const componentConditions = skus.map((sku) => sql`${analyticsChannelProductOverrides.components} @> ${JSON.stringify([{ sku }])}::jsonb`)
  const [inventoryRows, purchaseRows, channelRows] = await Promise.all([
    db
      .select({
        sku: inventory.sku,
        availableStock: sql<number>`COALESCE(SUM(${inventory.availableStock}), 0)::int`,
      })
      .from(inventory)
      .where(and(eq(inventory.userId, userId), inArray(inventory.sku, skus)))
      .groupBy(inventory.sku),
    db
      .select({ status: purchaseRequestItems.status, requestedQuantity: purchaseRequestItems.requestedQuantity })
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, userId), inArray(purchaseRequestItems.sku, skus))),
    db
      .select({ saleStatus: analyticsChannelProductOverrides.saleStatus })
      .from(analyticsChannelProductOverrides)
      .where(and(eq(analyticsChannelProductOverrides.userId, userId), or(...componentConditions))),
  ])

  const stockBySku = new Map(inventoryRows.map((row) => [row.sku, row.availableStock]))
  const statusCounts = new Map<string, number>()
  for (const row of purchaseRows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1)
  }

  return {
    totalAvailableStock: inventoryRows.reduce((sum, row) => sum + row.availableStock, 0),
    zeroStockSkuCount: skus.filter((sku) => (stockBySku.get(sku) ?? 0) <= 0).length,
    inventorySkuCount: inventoryRows.length,
    purchaseRowCount: purchaseRows.length,
    purchaseQuantity: purchaseRows.reduce((sum, row) => sum + row.requestedQuantity, 0),
    purchaseStatuses: Array.from(statusCounts, ([status, count]) => ({ status, count })),
    channelProductCount: channelRows.length,
    sellingChannelProductCount: channelRows.filter((row) => /판매중/.test(row.saleStatus)).length,
  }
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
 * Update a product's sell/display status from the product list.
 */
export async function updateProductStatusAction(
  productId: string,
  status: Exclude<ProductStatus, 'deleted'>,
): Promise<ActionResult<void>> {
  const userId = await requireUser()
  return updateProductStatus(userId, productId, status)
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
