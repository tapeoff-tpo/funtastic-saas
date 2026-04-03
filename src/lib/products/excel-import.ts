/**
 * Excel bulk import for products.
 *
 * Parses uploaded Excel files into product data, validates rows,
 * groups by SKU (base product + variants), and creates/updates
 * products via existing server actions.
 *
 * Server-side only. Uses ExcelJS for parsing and Zod for validation.
 * Reuses patterns from Phase 3 shipping Excel import.
 */

import ExcelJS from 'exceljs'
import { z } from 'zod'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { createProduct, updateProduct } from './actions'
import type { ProductFormData, VariantFormData } from './types'

/** Column headers expected in the import Excel file (Korean) */
const EXPECTED_COLUMNS = {
  sku: '상품코드',
  name: '상품명',
  description: '설명',
  basePrice: '판매가',
  costPrice: '원가',
  category: '카테고리',
  optionName: '옵션명',
  optionValue: '옵션값',
  optionPriceAdjustment: '옵션가격조정',
  optionSku: '옵션SKU',
} as const

/** A single parsed row from the Excel file */
export interface ParsedRow {
  row: number
  sku: string
  name: string
  description: string | null
  basePrice: number
  costPrice: number | null
  category: string | null
  optionName: string | null
  optionValue: string | null
  optionPriceAdjustment: number | null
  optionSku: string | null
}

/** A product grouped from parsed rows (base + variants) */
export interface ParsedProduct {
  sku: string
  name: string
  description: string | null
  basePrice: number
  costPrice: number | null
  category: string | null
  variants: Array<{
    sku: string
    optionName: string | null
    optionValue: string | null
    priceAdjustment: number
  }>
}

/** A row that failed validation */
export interface ValidationError {
  row: number
  errors: string[]
}

/** Result of parsing an Excel file */
export interface ParseResult {
  products: ParsedProduct[]
  errors: ValidationError[]
}

/** Result of bulk import operation */
export interface ImportResult {
  created: number
  updated: number
  errors: Array<{ row: number; error: string }>
}

/** Zod schema for row validation */
const rowSchema = z.object({
  sku: z.string().min(1, '상품코드가 비어있습니다'),
  name: z.string().min(1, '상품명이 비어있습니다'),
  basePrice: z.number().positive('판매가는 0보다 커야 합니다'),
  costPrice: z.number().nonnegative().nullable().optional(),
})

/**
 * Detect column indices from the header row.
 * Returns a mapping of field name to 1-based column index.
 */
function detectColumns(
  headerRow: ExcelJS.Row,
): Map<string, number> | null {
  const mapping = new Map<string, number>()

  headerRow.eachCell((cell, colNumber) => {
    const value = String(cell.value ?? '').trim()

    for (const [key, label] of Object.entries(EXPECTED_COLUMNS)) {
      if (value === label) {
        mapping.set(key, colNumber)
      }
    }
  })

  // Require at minimum: sku, name, basePrice
  if (!mapping.has('sku') || !mapping.has('name') || !mapping.has('basePrice')) {
    return null
  }

  return mapping
}

/**
 * Parse an uploaded Excel buffer into product data.
 *
 * Expected format: one row per variant. Rows with the same 상품코드 (SKU)
 * are grouped into a single product with multiple variants.
 *
 * If a product has no option columns filled, a default variant is created
 * using the product SKU.
 */
export async function parseProductExcel(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as ExcelJS.Buffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    return { products: [], errors: [{ row: 0, errors: ['워크시트가 비어있습니다'] }] }
  }

  const headerRow = worksheet.getRow(1)
  const columns = detectColumns(headerRow)
  if (!columns) {
    return {
      products: [],
      errors: [{
        row: 1,
        errors: ['필수 컬럼이 누락되었습니다: 상품코드, 상품명, 판매가'],
      }],
    }
  }

  const parsedRows: ParsedRow[] = []
  const errors: ValidationError[] = []

  const getCellValue = (row: ExcelJS.Row, colName: string): string => {
    const colIdx = columns.get(colName)
    if (!colIdx) return ''
    return String(row.getCell(colIdx).value ?? '').trim()
  }

  const getCellNumber = (row: ExcelJS.Row, colName: string): number | null => {
    const colIdx = columns.get(colName)
    if (!colIdx) return null
    const val = row.getCell(colIdx).value
    if (val == null || val === '') return null
    const num = Number(val)
    return isNaN(num) ? null : num
  }

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // skip header

    const sku = getCellValue(row, 'sku')
    const name = getCellValue(row, 'name')
    const basePriceRaw = getCellNumber(row, 'basePrice')

    // Validate required fields
    const result = rowSchema.safeParse({
      sku,
      name,
      basePrice: basePriceRaw,
    })

    if (!result.success) {
      errors.push({
        row: rowNumber,
        errors: result.error.issues.map((issue) => issue.message),
      })
      return
    }

    parsedRows.push({
      row: rowNumber,
      sku,
      name,
      description: getCellValue(row, 'description') || null,
      basePrice: basePriceRaw!,
      costPrice: getCellNumber(row, 'costPrice'),
      category: getCellValue(row, 'category') || null,
      optionName: getCellValue(row, 'optionName') || null,
      optionValue: getCellValue(row, 'optionValue') || null,
      optionPriceAdjustment: getCellNumber(row, 'optionPriceAdjustment'),
      optionSku: getCellValue(row, 'optionSku') || null,
    })
  })

  // Group rows by SKU
  const skuGroups = new Map<string, ParsedRow[]>()
  for (const row of parsedRows) {
    const group = skuGroups.get(row.sku) ?? []
    group.push(row)
    skuGroups.set(row.sku, group)
  }

  // Convert groups to ParsedProduct
  const products: ParsedProduct[] = []

  for (const [sku, rows] of Array.from(skuGroups.entries())) {
    const first = rows[0]

    const variants: ParsedProduct['variants'] = []
    for (const row of rows) {
      if (row.optionSku || row.optionName) {
        variants.push({
          sku: row.optionSku ?? `${sku}-${variants.length + 1}`,
          optionName: row.optionName,
          optionValue: row.optionValue,
          priceAdjustment: row.optionPriceAdjustment ?? 0,
        })
      }
    }

    // If no variants detected, create a default variant using the product SKU
    if (variants.length === 0) {
      variants.push({
        sku,
        optionName: null,
        optionValue: null,
        priceAdjustment: 0,
      })
    }

    products.push({
      sku,
      name: first.name,
      description: first.description,
      basePrice: first.basePrice,
      costPrice: first.costPrice,
      category: first.category,
      variants,
    })
  }

  // Check for duplicate SKUs across variants
  const allVariantSkus = new Set<string>()
  for (const product of products) {
    for (const variant of product.variants) {
      if (allVariantSkus.has(variant.sku)) {
        errors.push({
          row: 0,
          errors: [`중복 옵션SKU: ${variant.sku}`],
        })
      }
      allVariantSkus.add(variant.sku)
    }
  }

  return { products, errors }
}

/**
 * Bulk import parsed products: create new or update existing.
 *
 * For each product:
 * - Check if internalSku already exists for user -> update
 * - If new -> create via createProduct action
 *
 * Processes in batches of 50 to avoid memory issues.
 */
export async function bulkImportProducts(
  userId: string,
  parsedProducts: ParsedProduct[],
): Promise<ImportResult> {
  let created = 0
  let updated = 0
  const importErrors: ImportResult['errors'] = []

  const BATCH_SIZE = 50

  for (let i = 0; i < parsedProducts.length; i += BATCH_SIZE) {
    const batch = parsedProducts.slice(i, i + BATCH_SIZE)

    for (const parsed of batch) {
      try {
        // Check if product with this SKU already exists
        const [existing] = await db
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              eq(products.userId, userId),
              eq(products.internalSku, parsed.sku),
            ),
          )
          .limit(1)

        const formData: ProductFormData = {
          name: parsed.name,
          description: parsed.description ?? undefined,
          internalSku: parsed.sku,
          basePrice: parsed.basePrice,
          costPrice: parsed.costPrice ?? undefined,
          categoryId: parsed.category ?? undefined,
          variants: parsed.variants.map((v): VariantFormData => ({
            sku: v.sku,
            optionName: v.optionName ?? undefined,
            optionValues: v.optionValue
              ? { [v.optionName ?? 'default']: v.optionValue }
              : undefined,
            priceAdjustment: v.priceAdjustment,
          })),
        }

        if (existing) {
          const result = await updateProduct(userId, existing.id, formData)
          if (result.success) {
            updated++
          } else {
            importErrors.push({ row: 0, error: `${parsed.sku}: ${'error' in result ? result.error : 'Unknown error'}` })
          }
        } else {
          const result = await createProduct(userId, formData)
          if (result.success) {
            created++
          } else {
            importErrors.push({ row: 0, error: `${parsed.sku}: ${'error' in result ? result.error : 'Unknown error'}` })
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        importErrors.push({ row: 0, error: `${parsed.sku}: ${message}` })
      }
    }
  }

  return { created, updated, errors: importErrors }
}
