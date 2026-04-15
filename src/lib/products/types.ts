/**
 * Product domain types and constants.
 *
 * Defines product, variant, marketplace link, and category mapping
 * interfaces for the product management system.
 */

export type ProductStatus = 'draft' | 'active' | 'inactive' | 'deleted'

export type ProductSyncStatus = 'synced' | 'pending' | 'error'

export interface ProductImage {
  url: string
  sortOrder: number
}

export interface Product {
  id: string
  userId: string
  internalSku: string
  name: string
  description: string | null
  basePrice: string // numeric comes as string from Drizzle
  costPrice: string | null
  categoryId: string | null
  status: ProductStatus
  images: ProductImage[] | null
  metadata: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface ProductVariant {
  id: string
  productId: string
  sku: string
  optionName: string | null
  optionValues: Record<string, string> | null
  priceAdjustment: string // numeric comes as string from Drizzle
  isActive: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface ProductMarketplaceLink {
  id: string
  productId: string
  variantId: string | null
  marketplaceId: string
  marketplaceProductId: string
  marketplaceCategoryId: string | null
  syncStatus: string
  lastSyncedAt: Date | null
  lastSyncError: string | null
  rawData: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

export interface CategoryMapping {
  id: string
  userId: string
  internalCategory: string
  marketplaceId: string
  marketplaceCategoryId: string
  marketplaceCategoryName: string | null
  createdAt: Date
  updatedAt: Date
}

/** Form data for creating/updating a product with variants */
export interface ProductFormData {
  name: string
  description?: string
  internalSku: string
  basePrice: number
  costPrice?: number
  categoryId?: string
  images?: ProductImage[]
  metadata?: Record<string, unknown>
  variants: VariantFormData[]
}

export interface VariantFormData {
  id?: string // present when updating existing variant
  sku: string
  optionName?: string
  optionValues?: Record<string, string>
  priceAdjustment?: number
}

/** Filters for product list queries */
export interface ProductFilters {
  page?: number
  pageSize?: number
  search?: string
  status?: ProductStatus
  categoryId?: string
  sort?: string
  order?: 'asc' | 'desc'
  /** SKU 접두사 필터 텍스트 */
  skuPrefix?: string
  /** true = 해당 접두사 제외, false = 해당 접두사 포함 */
  skuExclude?: boolean
}

/** Product with variant count for list views */
export interface ProductListItem extends Product {
  variantCount: number
}

/** Full product detail with variants and marketplace links */
export interface ProductDetail extends Product {
  variants: ProductVariant[]
  marketplaceLinks: ProductMarketplaceLink[]
}

/** Korean labels for product status */
export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: '임시저장',
  active: '판매중',
  inactive: '판매중지',
  deleted: '삭제됨',
}
