'use server'

/**
 * Product sync to marketplaces.
 *
 * Pushes product data to connected marketplaces via adapter methods.
 * Resolves category mappings before sync. Tracks sync status in
 * productMarketplaceLinks table.
 */

import { db } from '@/lib/db'
import {
  products,
  productVariants,
  productMarketplaceLinks,
  marketplaceConnections,
} from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { getMappedMarketplaceCategory } from './categories'
import type { NormalizedProduct } from '@/lib/marketplace/types'

interface SyncResult {
  success: boolean
  marketplaceProductId?: string
  error?: string
}

/**
 * Sync a single product to a specific marketplace.
 *
 * Flow:
 * 1. Load product with variants from DB
 * 2. Look up category mapping for product's category + target marketplace
 * 3. Convert to NormalizedProduct format
 * 4. Check productMarketplaceLinks: if link exists -> updateProduct(), else -> registerProduct()
 * 5. Update/create productMarketplaceLink with syncStatus and lastSyncedAt
 */
export async function syncProductToMarketplace(
  productId: string,
  marketplaceId: string,
  connectionId: string,
): Promise<SyncResult> {
  try {
    // 1. Load product with variants
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1)

    if (!product) {
      return { success: false, error: 'Product not found' }
    }

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))

    // 2. Resolve category mapping
    let marketplaceCategoryId: string | undefined
    if (product.categoryId) {
      const mapped = await getMappedMarketplaceCategory(
        product.userId,
        product.categoryId,
        marketplaceId,
      )
      if (mapped) {
        marketplaceCategoryId = mapped
      }
    }

    // 3. Convert to NormalizedProduct
    const normalizedProduct: NormalizedProduct = {
      productId: product.id,
      marketplaceId,
      name: product.name,
      description: product.description ?? undefined,
      price: Number(product.basePrice),
      sku: product.internalSku,
      categoryId: product.categoryId ?? undefined,
      marketplaceCategoryId,
      images: product.images ?? undefined,
      variants: variants.map((v: { sku: string; optionName: string | null; optionValues: Record<string, string> | null; priceAdjustment: string; isActive: boolean }) => ({
        sku: v.sku,
        optionName: v.optionName ?? undefined,
        optionValues: v.optionValues ?? undefined,
        price: Number(product.basePrice) + Number(v.priceAdjustment),
        isActive: v.isActive,
      })),
      metadata: product.metadata ?? undefined,
    }

    // 4. Check for existing marketplace link
    const [existingLink] = await db
      .select()
      .from(productMarketplaceLinks)
      .where(
        and(
          eq(productMarketplaceLinks.productId, productId),
          eq(productMarketplaceLinks.marketplaceId, marketplaceId),
        ),
      )
      .limit(1)

    // Get the adapter
    const adapter = marketplaceRegistry.get(marketplaceId)

    let result: SyncResult

    if (existingLink) {
      // Update existing product
      const updateResult = await adapter.updateProduct(
        existingLink.marketplaceProductId,
        normalizedProduct,
      )
      result = {
        success: updateResult.success,
        marketplaceProductId: existingLink.marketplaceProductId,
        error: updateResult.error,
      }
    } else {
      // Register new product
      const registerResult = await adapter.registerProduct(normalizedProduct)
      result = {
        success: registerResult.success,
        marketplaceProductId: registerResult.marketplaceProductId,
        error: registerResult.error,
      }
    }

    // 5. Update/create productMarketplaceLink
    const now = new Date()

    if (existingLink) {
      await db
        .update(productMarketplaceLinks)
        .set({
          syncStatus: result.success ? 'synced' : 'error',
          lastSyncedAt: now,
          lastSyncError: result.error ?? null,
          marketplaceCategoryId: marketplaceCategoryId ?? null,
          updatedAt: now,
        })
        .where(eq(productMarketplaceLinks.id, existingLink.id))
    } else if (result.success && result.marketplaceProductId) {
      await db
        .insert(productMarketplaceLinks)
        .values({
          productId,
          marketplaceId,
          marketplaceProductId: result.marketplaceProductId,
          marketplaceCategoryId: marketplaceCategoryId ?? null,
          syncStatus: 'synced',
          lastSyncedAt: now,
          lastSyncError: null,
        })
    } else if (!result.success) {
      // Failed registration -- store error in a link with placeholder ID
      await db
        .insert(productMarketplaceLinks)
        .values({
          productId,
          marketplaceId,
          marketplaceProductId: `pending_${productId}_${marketplaceId}`,
          marketplaceCategoryId: marketplaceCategoryId ?? null,
          syncStatus: 'error',
          lastSyncedAt: now,
          lastSyncError: result.error ?? 'Registration failed',
        })
    }

    return result
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown sync error'
    return { success: false, error }
  }
}

/**
 * Sync a product to all active marketplace connections for the product's user.
 * Returns results array with per-marketplace status.
 */
export async function syncProductToAllMarketplaces(
  productId: string,
): Promise<Array<{ marketplaceId: string; connectionId: string } & SyncResult>> {
  // Load product to get userId
  const [product] = await db
    .select({ userId: products.userId })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)

  if (!product) {
    return [{ marketplaceId: 'unknown', connectionId: 'unknown', success: false, error: 'Product not found' }]
  }

  // Get all active connections for user
  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(
      and(
        eq(marketplaceConnections.userId, product.userId),
        eq(marketplaceConnections.status, 'connected'),
      ),
    )

  const results: Array<{ marketplaceId: string; connectionId: string } & SyncResult> = []

  for (const conn of connections) {
    // Only sync to marketplaces that have a registered adapter
    if (!marketplaceRegistry.has(conn.marketplaceId)) {
      results.push({
        marketplaceId: conn.marketplaceId,
        connectionId: conn.id,
        success: false,
        error: `No adapter registered for ${conn.marketplaceId}`,
      })
      continue
    }

    const result = await syncProductToMarketplace(productId, conn.marketplaceId, conn.id)
    results.push({
      marketplaceId: conn.marketplaceId,
      connectionId: conn.id,
      ...result,
    })
  }

  return results
}
