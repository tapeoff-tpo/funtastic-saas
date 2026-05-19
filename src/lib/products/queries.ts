/**
 * Product queries with server-side filtering and pagination.
 *
 * Used by the product management UI to list, search, and view
 * products with their variants and marketplace links.
 */

import { db } from '@/lib/db'
import {
  products,
  productVariants,
  productMarketplaceLinks,
  inventory,
} from '@/lib/db/schema'
import { eq, and, or, ilike, desc, asc, count, ne, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { ProductFilters, ProductListItem, ProductDetail } from './types'

const DEFAULT_PAGE_SIZE = 50

/**
 * Get paginated product list with variant count, search, and sorting.
 */
export async function getProducts(
  userId: string,
  filters: ProductFilters = {},
): Promise<{ items: ProductListItem[]; total: number }> {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const offset = (page - 1) * pageSize

  const conditions: SQL[] = [
    eq(products.userId, userId),
    // Exclude soft-deleted by default
    ne(products.status, 'deleted'),
  ]

  if (filters.status) {
    // Override: if explicitly requesting deleted, remove the ne filter
    if (filters.status === 'deleted') {
      conditions.pop()
    }
    conditions.push(eq(products.status, filters.status))
  }

  if (filters.categoryId) {
    conditions.push(eq(products.categoryId, filters.categoryId))
  }

  if (filters.manageInventory === true) {
    conditions.push(eq(products.manageInventory, true))
  }

  if (filters.search) {
    const searchPattern = `%${filters.search}%`
    conditions.push(
      or(
        ilike(products.name, searchPattern),
        ilike(products.internalSku, searchPattern),
      )!,
    )
  }
  const whereClause = and(...conditions)

  const sortColumn = (() => {
    switch (filters.sort) {
      case 'name': return products.name
      case 'internalSku': return products.internalSku
      case 'basePrice': return products.basePrice
      case 'costPrice': return products.costPrice
      case 'warehouseLocation': return products.warehouseLocation
      case 'status': return products.status
      case 'updatedAt': return products.updatedAt
      // 기본: 같은 품번끼리 인접하도록 internalSku asc.
      default: return products.internalSku
    }
  })()

  // 정렬 미지정 시 internalSku asc (품번 그룹핑). 그 외엔 사용자 선택 따름.
  const sortDirection = filters.sort
    ? (filters.order === 'asc' ? asc : desc)
    : asc

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        userId: products.userId,
        internalSku: products.internalSku,
        name: products.name,
        description: products.description,
        basePrice: products.basePrice,
        costPrice: products.costPrice,
        warehouseLocation: products.warehouseLocation,
        defaultCarrierId: products.defaultCarrierId,
        manageInventory: products.manageInventory,
        categoryId: products.categoryId,
        status: products.status,
        images: products.images,
        metadata: products.metadata,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        variantCount: sql<number>`cast(count(${productVariants.id}) as int)`,
        // inventory.sku == products.internal_sku 1:1. MAX 로 집계 (groupBy 충족용).
        optionName: sql<string | null>`max(${inventory.optionName})`,
      })
      .from(products)
      .leftJoin(productVariants, eq(products.id, productVariants.productId))
      .leftJoin(
        inventory,
        and(eq(inventory.sku, products.internalSku), eq(inventory.userId, products.userId)),
      )
      .where(whereClause)
      .groupBy(products.id)
      .orderBy(sortDirection(sortColumn))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(products)
      .where(whereClause),
  ])

  return { items: rows as ProductListItem[], total }
}

/**
 * Get a single product by ID with all variants and marketplace links.
 */
export async function getProductById(
  productId: string,
): Promise<ProductDetail | null> {
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)

  if (!product) return null

  const [variants, marketplaceLinks] = await Promise.all([
    db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(asc(productVariants.sortOrder)),
    db
      .select()
      .from(productMarketplaceLinks)
      .where(eq(productMarketplaceLinks.productId, productId)),
  ])

  return {
    ...product,
    variants,
    marketplaceLinks,
  } as ProductDetail
}

/**
 * Get all variants for a product.
 */
export async function getProductVariants(productId: string) {
  return db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.sortOrder))
}

/**
 * Get all marketplace links for a product.
 */
export async function getProductMarketplaceLinks(productId: string) {
  return db
    .select()
    .from(productMarketplaceLinks)
    .where(eq(productMarketplaceLinks.productId, productId))
}

/**
 * Search products by name or SKU for autocomplete.
 * Returns up to 20 results.
 */
export async function searchProducts(userId: string, query: string) {
  const searchPattern = `%${query}%`

  return db
    .select({
      id: products.id,
      name: products.name,
      internalSku: products.internalSku,
      status: products.status,
    })
    .from(products)
    .where(
      and(
        eq(products.userId, userId),
        ne(products.status, 'deleted'),
        or(
          ilike(products.name, searchPattern),
          ilike(products.internalSku, searchPattern),
        ),
      ),
    )
    .limit(20)
}
