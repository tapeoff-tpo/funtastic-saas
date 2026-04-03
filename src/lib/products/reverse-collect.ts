'use server'

/**
 * Reverse collection -- import existing products from connected marketplaces.
 *
 * Fetches products via adapter.getProducts(), then creates internal product
 * records with variants, marketplace links, and inventory records.
 * Idempotent: skips products already linked via productMarketplaceLinks.
 */

import { db } from '@/lib/db'
import {
  marketplaceConnections,
  products,
  productVariants,
  productMarketplaceLinks,
} from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { readCredential } from '@/lib/supabase/admin'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { CoupangAdapter } from '@/lib/marketplace/adapters/coupang/adapter'
import { NaverAdapter } from '@/lib/marketplace/adapters/naver/adapter'
import { setStock } from '@/lib/inventory/actions'
import type { MarketplaceAdapter, NormalizedProduct } from '@/lib/marketplace/types'

export interface ReverseCollectResult {
  imported: number
  skipped: number
  errors: string[]
}

/**
 * Create a marketplace adapter with full capabilities from stored credentials.
 */
async function createAdapterWithCredentials(
  marketplaceId: string,
  userId: string,
): Promise<MarketplaceAdapter> {
  const adapterConfig = marketplaceRegistry.get(marketplaceId)
  const requiredCreds = adapterConfig.config.requiredCredentials
  const credentials: Record<string, string> = {}

  for (const credKey of requiredCreds) {
    const value = await readCredential(marketplaceId, userId, credKey)
    if (!value) {
      throw new Error(`Missing credential "${credKey}" for ${marketplaceId}`)
    }
    credentials[credKey] = value
  }

  switch (marketplaceId) {
    case 'coupang':
      return new CoupangAdapter({
        access_key: credentials.access_key ?? '',
        secret_key: credentials.secret_key ?? '',
        vendor_id: credentials.vendor_id ?? '',
      })
    case 'naver':
      return new NaverAdapter({
        client_id: credentials.client_id ?? '',
        client_secret: credentials.client_secret ?? '',
      })
    default:
      throw new Error(`Unknown marketplace: ${marketplaceId}`)
  }
}

/**
 * Generate an internal SKU prefix from marketplace ID.
 */
function skuPrefix(marketplaceId: string): string {
  const prefixes: Record<string, string> = {
    coupang: 'CPG',
    naver: 'NVR',
    elevenst: '11S',
    gmarket: 'GMK',
    auction: 'AUC',
  }
  return prefixes[marketplaceId] ?? marketplaceId.toUpperCase().slice(0, 3)
}

/**
 * Import all products from a connected marketplace into the internal database.
 *
 * @param userId - The owner user ID
 * @param connectionId - The marketplace_connections row ID
 * @param marketplaceId - The marketplace identifier (e.g., 'coupang', 'naver')
 * @returns Import result with counts of imported, skipped, and errors
 */
export async function reverseCollectProducts(
  userId: string,
  connectionId: string,
  marketplaceId: string,
): Promise<ReverseCollectResult> {
  const result: ReverseCollectResult = { imported: 0, skipped: 0, errors: [] }

  // Verify connection belongs to user
  const [connection] = await db
    .select({ id: marketplaceConnections.id })
    .from(marketplaceConnections)
    .where(
      and(
        eq(marketplaceConnections.id, connectionId),
        eq(marketplaceConnections.userId, userId),
      ),
    )
    .limit(1)

  if (!connection) {
    throw new Error('Connection not found or access denied')
  }

  // Create adapter with credentials from vault
  const adapter = await createAdapterWithCredentials(marketplaceId, userId)
  await adapter.authenticate()

  // Fetch all products from marketplace
  const marketplaceProducts = await adapter.getProducts()
  const prefix = skuPrefix(marketplaceId)

  for (const mp of marketplaceProducts) {
    try {
      await importSingleProduct(userId, connectionId, marketplaceId, mp, prefix)
      result.imported++
    } catch (err) {
      if (err instanceof Error && err.message === 'SKIP_DUPLICATE') {
        result.skipped++
      } else {
        result.errors.push(
          `Product ${mp.productId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        )
      }
    }
  }

  return result
}

/**
 * Import a single marketplace product into the internal database.
 * Runs inside a transaction. Throws 'SKIP_DUPLICATE' if already linked.
 */
async function importSingleProduct(
  userId: string,
  connectionId: string,
  marketplaceId: string,
  mp: NormalizedProduct,
  prefix: string,
): Promise<void> {
  // Check for existing link (idempotent: skip if already imported)
  const [existingLink] = await db
    .select({ id: productMarketplaceLinks.id })
    .from(productMarketplaceLinks)
    .where(
      and(
        eq(productMarketplaceLinks.marketplaceId, marketplaceId),
        eq(productMarketplaceLinks.marketplaceProductId, mp.productId),
      ),
    )
    .limit(1)

  if (existingLink) {
    throw new Error('SKIP_DUPLICATE')
  }

  const internalSku = `${prefix}-${mp.productId}`

  // Run product + variants + link creation in a transaction
  const { productId, variantSkus } = await db.transaction(async (tx) => {
    // Create internal product
    const [product] = await tx
      .insert(products)
      .values({
        userId,
        internalSku,
        name: mp.name,
        description: mp.description ?? null,
        basePrice: String(mp.price),
        costPrice: mp.costPrice != null ? String(mp.costPrice) : null,
        categoryId: mp.categoryId ?? null,
        status: 'active',
        images: mp.images && mp.images.length > 0 ? mp.images : null,
        metadata: { sourceConnectionId: connectionId },
      })
      .returning({ id: products.id })

    // Create variants
    const createdVariantSkus: string[] = []

    if (mp.variants && mp.variants.length > 0) {
      for (let idx = 0; idx < mp.variants.length; idx++) {
        const v = mp.variants[idx]
        const variantSku = v.sku || `${internalSku}-V${idx + 1}`

        await tx.insert(productVariants).values({
          productId: product.id,
          sku: variantSku,
          optionName: v.optionName ?? null,
          optionValues: v.optionValues && Object.keys(v.optionValues).length > 0 ? v.optionValues : null,
          priceAdjustment: String(v.price - mp.price),
          sortOrder: idx,
        })

        createdVariantSkus.push(variantSku)
      }
    } else {
      // No variants -- create a default variant matching the product
      const defaultSku = `${internalSku}-DEF`
      await tx.insert(productVariants).values({
        productId: product.id,
        sku: defaultSku,
        optionName: null,
        optionValues: null,
        priceAdjustment: '0',
        sortOrder: 0,
      })
      createdVariantSkus.push(defaultSku)
    }

    // Create marketplace link
    await tx.insert(productMarketplaceLinks).values({
      productId: product.id,
      marketplaceId,
      marketplaceProductId: mp.productId,
      marketplaceCategoryId: mp.categoryId ?? null,
      syncStatus: 'synced',
      lastSyncedAt: new Date(),
      rawData: mp.rawData,
    })

    return { productId: product.id, variantSkus: createdVariantSkus }
  })

  // Create inventory records for each variant (outside main tx; setStock has its own)
  for (const sku of variantSkus) {
    const stockQty = mp.variants.find((v) => (v.sku || '') === sku)?.stockQuantity ?? 0
    await setStock(userId, sku, mp.name, stockQty)
  }
}

/**
 * Get reverse collection progress/status for a user.
 * Returns counts of products by marketplace link status.
 */
export async function getCollectionProgress(
  userId: string,
): Promise<{
  totalProducts: number
  linkedProducts: number
  byMarketplace: Record<string, number>
}> {
  const allProducts = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.userId, userId))

  const allLinks = await db
    .select({
      marketplaceId: productMarketplaceLinks.marketplaceId,
    })
    .from(productMarketplaceLinks)
    .innerJoin(products, eq(products.id, productMarketplaceLinks.productId))
    .where(eq(products.userId, userId))

  const byMarketplace: Record<string, number> = {}
  for (const link of allLinks) {
    byMarketplace[link.marketplaceId] = (byMarketplace[link.marketplaceId] ?? 0) + 1
  }

  return {
    totalProducts: allProducts.length,
    linkedProducts: allLinks.length,
    byMarketplace,
  }
}
