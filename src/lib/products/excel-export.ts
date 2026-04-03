/**
 * Product Excel export with styled headers.
 *
 * Generates formatted Excel files for product catalog download.
 * Export format matches import format for round-trip compatibility:
 * one row per variant, product info repeated for each variant row.
 *
 * Server-side only. Uses ExcelJS for workbook generation.
 * Reuses patterns from Phase 3 shipping Excel export.
 */

import ExcelJS from 'exceljs'
import { getProducts } from './queries'
import { db } from '@/lib/db'
import { productVariants } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'
import type { ProductFilters, ProductListItem } from './types'

/** Column definitions for the product export sheet */
const COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: '상품코드', key: 'sku', width: 15 },
  { header: '상품명', key: 'name', width: 30 },
  { header: '설명', key: 'description', width: 40 },
  { header: '판매가', key: 'basePrice', width: 12 },
  { header: '원가', key: 'costPrice', width: 12 },
  { header: '카테고리', key: 'category', width: 15 },
  { header: '상태', key: 'status', width: 10 },
  { header: '옵션명', key: 'optionName', width: 15 },
  { header: '옵션값', key: 'optionValue', width: 20 },
  { header: '옵션가격조정', key: 'optionPriceAdjustment', width: 12 },
  { header: '옵션SKU', key: 'optionSku', width: 15 },
]

/** Header style: bold text on gray background with thin borders */
const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE0E0E0' },
}

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}

/** Status labels for export (Korean) */
const STATUS_LABELS: Record<string, string> = {
  draft: '임시저장',
  active: '판매중',
  inactive: '판매중지',
  deleted: '삭제됨',
}

/**
 * Export products to an Excel workbook.
 *
 * Fetches products with their variants and produces a styled workbook
 * with one row per variant (product fields repeated). This matches
 * the import format for round-trip editing capability.
 *
 * @param userId - Owner of the products
 * @param filters - Optional filters (status, category, search)
 * @returns Buffer containing the .xlsx file
 */
export async function exportProductsToExcel(
  userId: string,
  filters?: ProductFilters,
): Promise<Buffer> {
  // Fetch all products (override pagination for full export)
  const exportFilters: ProductFilters = {
    ...filters,
    page: 1,
    pageSize: 10000, // Fetch all for export
  }

  const { items: productItems } = await getProducts(userId, exportFilters)

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('상품목록')

  // Set columns
  worksheet.columns = COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }))

  // Style header row
  const headerRow = worksheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = THIN_BORDER
  })

  // Fetch variants for all products
  for (const product of productItems) {
    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id))
      .orderBy(asc(productVariants.sortOrder))

    if (variants.length === 0) {
      // Product with no variants: single row
      worksheet.addRow({
        sku: product.internalSku,
        name: product.name,
        description: product.description ?? '',
        basePrice: Number(product.basePrice),
        costPrice: product.costPrice ? Number(product.costPrice) : '',
        category: product.categoryId ?? '',
        status: STATUS_LABELS[product.status] ?? product.status,
        optionName: '',
        optionValue: '',
        optionPriceAdjustment: '',
        optionSku: '',
      })
    } else {
      // One row per variant with product info repeated
      for (const variant of variants) {
        // Format option values as comma-separated string
        const optionValueStr = variant.optionValues
          ? Object.values(variant.optionValues).join(', ')
          : ''

        worksheet.addRow({
          sku: product.internalSku,
          name: product.name,
          description: product.description ?? '',
          basePrice: Number(product.basePrice),
          costPrice: product.costPrice ? Number(product.costPrice) : '',
          category: product.categoryId ?? '',
          status: STATUS_LABELS[product.status] ?? product.status,
          optionName: variant.optionName ?? '',
          optionValue: optionValueStr,
          optionPriceAdjustment: Number(variant.priceAdjustment) || '',
          optionSku: variant.sku,
        })
      }
    }
  }

  // Phase 3 pattern: cast through unknown for Node.js 24 Buffer compatibility
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return arrayBuffer as unknown as Buffer
}
