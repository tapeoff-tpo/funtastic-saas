'use server'

/**
 * Product management server actions.
 *
 * Provides CRUD operations for products and variants:
 * - createProduct: insert product + variants + inventory records in a transaction
 * - updateProduct: upsert product fields and variants
 * - deleteProduct: soft delete (set status to 'deleted')
 * - updateProductStatus: change product status
 */

import { db } from '@/lib/db'
import { products, productVariants } from '@/lib/db/schema'
import { eq, and, notInArray } from 'drizzle-orm'
import { setStock } from '@/lib/inventory/actions'
import type { ProductFormData } from './types'

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string }

/**
 * Create a new product with variants.
 * Also creates inventory records (initial stock 0) for each variant SKU.
 */
export async function createProduct(
  userId: string,
  formData: ProductFormData,
): Promise<ActionResult<{ productId: string }>> {
  try {
    const result = await db.transaction(async (tx) => {
      // Insert product
      const [product] = await tx
        .insert(products)
        .values({
          userId,
          internalSku: formData.internalSku,
          name: formData.name,
          description: formData.description ?? null,
          basePrice: String(formData.basePrice),
          costPrice: formData.costPrice != null ? String(formData.costPrice) : null,
          categoryId: formData.categoryId ?? null,
          images: formData.images ?? null,
          metadata: formData.metadata ?? null,
        })
        .returning({ id: products.id })

      // Insert variants
      if (formData.variants.length > 0) {
        await tx.insert(productVariants).values(
          formData.variants.map((v, idx) => ({
            productId: product.id,
            sku: v.sku,
            optionName: v.optionName ?? null,
            optionValues: v.optionValues ?? null,
            priceAdjustment: String(v.priceAdjustment ?? 0),
            sortOrder: idx,
          })),
        )
      }

      return product.id
    })

    // Create inventory records for each variant (outside transaction since setStock has its own tx)
    for (const variant of formData.variants) {
      await setStock(userId, variant.sku, formData.name, 0)
    }

    return { success: true, data: { productId: result } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error creating product'
    return { success: false, error: message }
  }
}

/**
 * Update an existing product and its variants.
 * - Updates product fields
 * - Upserts variants: updates existing, inserts new, deactivates removed
 * - Creates inventory records for any new variant SKUs
 */
export async function updateProduct(
  userId: string,
  productId: string,
  formData: ProductFormData,
): Promise<ActionResult<void>> {
  try {
    await db.transaction(async (tx) => {
      // Verify ownership
      const [existing] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.userId, userId)))
        .limit(1)

      if (!existing) {
        throw new Error('Product not found or access denied')
      }

      // Update product fields
      await tx
        .update(products)
        .set({
          internalSku: formData.internalSku,
          name: formData.name,
          description: formData.description ?? null,
          basePrice: String(formData.basePrice),
          costPrice: formData.costPrice != null ? String(formData.costPrice) : null,
          categoryId: formData.categoryId ?? null,
          images: formData.images ?? null,
          metadata: formData.metadata ?? null,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))

      // Separate existing vs new variants
      const existingVariantIds = formData.variants
        .filter((v) => v.id)
        .map((v) => v.id!)

      // Deactivate variants no longer in the form
      if (existingVariantIds.length > 0) {
        await tx
          .update(productVariants)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(productVariants.productId, productId),
              notInArray(productVariants.id, existingVariantIds),
            ),
          )
      } else {
        // All variants removed -- deactivate all existing
        await tx
          .update(productVariants)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(productVariants.productId, productId))
      }

      // Upsert each variant
      const newVariantSkus: string[] = []

      for (let idx = 0; idx < formData.variants.length; idx++) {
        const v = formData.variants[idx]
        if (v.id) {
          // Update existing variant
          await tx
            .update(productVariants)
            .set({
              sku: v.sku,
              optionName: v.optionName ?? null,
              optionValues: v.optionValues ?? null,
              priceAdjustment: String(v.priceAdjustment ?? 0),
              isActive: true,
              sortOrder: idx,
              updatedAt: new Date(),
            })
            .where(eq(productVariants.id, v.id))
        } else {
          // Insert new variant
          await tx.insert(productVariants).values({
            productId,
            sku: v.sku,
            optionName: v.optionName ?? null,
            optionValues: v.optionValues ?? null,
            priceAdjustment: String(v.priceAdjustment ?? 0),
            sortOrder: idx,
          })
          newVariantSkus.push(v.sku)
        }
      }

      return newVariantSkus
    }).then(async (newSkus) => {
      // Create inventory records for new variants
      for (const sku of newSkus) {
        await setStock(userId, sku, formData.name, 0)
      }
    })

    return { success: true, data: undefined }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error updating product'
    return { success: false, error: message }
  }
}

/**
 * Soft delete a product by setting status to 'deleted'.
 * Does NOT delete inventory records to preserve history.
 */
export async function deleteProduct(
  userId: string,
  productId: string,
): Promise<ActionResult<void>> {
  try {
    const [updated] = await db
      .update(products)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .returning({ id: products.id })

    if (!updated) {
      return { success: false, error: 'Product not found or access denied' }
    }

    return { success: true, data: undefined }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error deleting product'
    return { success: false, error: message }
  }
}

/**
 * Update product status (draft/active/inactive).
 */
export async function updateProductStatus(
  userId: string,
  productId: string,
  status: 'draft' | 'active' | 'inactive',
): Promise<ActionResult<void>> {
  try {
    const [updated] = await db
      .update(products)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .returning({ id: products.id })

    if (!updated) {
      return { success: false, error: 'Product not found or access denied' }
    }

    return { success: true, data: undefined }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error updating product status'
    return { success: false, error: message }
  }
}
