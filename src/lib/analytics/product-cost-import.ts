import ExcelJS from 'exceljs'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { productChangeLogs, products } from '@/lib/db/schema'

export interface ProductCostImportResult {
  totalRows: number
  updated: number
  unchanged: number
  unmatched: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

type ParsedCostRow = {
  sku: string
  costPrice: number
  rowNumber: number
}

export async function importProductCosts(data: {
  userId: string
  fileBuffer: ArrayBuffer
}): Promise<ProductCostImportResult> {
  const parsed = await parseProductCostWorkbook(data.fileBuffer)
  const uniqueRows = Array.from(new Map(parsed.rows.map((row) => [row.sku, row])).values())
  const existing = new Map<string, { id: string; costPrice: string | null }>()

  for (const skuChunk of chunks(uniqueRows.map((row) => row.sku), 1000)) {
    const rows = await db
      .select({ id: products.id, sku: products.internalSku, costPrice: products.costPrice })
      .from(products)
      .where(and(eq(products.userId, data.userId), inArray(products.internalSku, skuChunk)))
    for (const row of rows) existing.set(row.sku, { id: row.id, costPrice: row.costPrice })
  }

  const updates = uniqueRows
    .map((row) => ({ ...row, product: existing.get(row.sku) }))
    .filter((row): row is typeof row & { product: { id: string; costPrice: string | null } } => Boolean(row.product))
    .filter((row) => row.product.costPrice == null || Number(row.product.costPrice) !== row.costPrice)

  for (const updateChunk of chunks(updates, 250)) {
    await db.execute(sql`
      UPDATE products AS p
      SET
        cost_price = v.cost_price,
        updated_at = NOW()
      FROM (
        VALUES ${sql.join(updateChunk.map((row) => sql`(${row.product.id}::uuid, ${row.costPrice}::numeric)`), sql`, `)}
      ) AS v(id, cost_price)
      WHERE p.id = v.id
    `)
  }

  for (const updateChunk of chunks(updates, 500)) {
    await db.insert(productChangeLogs).values(updateChunk.map((row) => ({
      productId: row.product.id,
      userId: data.userId,
      fieldName: 'cost_price',
      oldValue: row.product.costPrice,
      newValue: String(row.costPrice),
    })))
  }

  const matched = uniqueRows.filter((row) => existing.has(row.sku))
  return {
    totalRows: parsed.totalRows,
    updated: updates.length,
    unchanged: matched.length - updates.length,
    unmatched: uniqueRows.length - matched.length,
    skipped: parsed.skipped,
    errors: parsed.errors,
  }
}

export async function parseProductCostWorkbook(fileBuffer: ArrayBuffer): Promise<{
  rows: ParsedCostRow[]
  totalRows: number
  skipped: number
  errors: ProductCostImportResult['errors']
}> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('원가 파일의 시트를 찾을 수 없습니다.')

  const headerRowNumber = findHeaderRow(sheet)
  if (!headerRowNumber) throw new Error('A열 품목코드와 N열 원가 헤더를 찾을 수 없습니다.')

  const rows: ParsedCostRow[] = []
  const errors: ProductCostImportResult['errors'] = []
  let totalRows = 0
  let skipped = 0

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return
    const sku = cellText(row.getCell(1).value)
    const rawCost = cellText(row.getCell(14).value)
    if (!sku && !rawCost) return
    totalRows += 1
    if (!sku || !rawCost) {
      skipped += 1
      return
    }

    const costPrice = Number(rawCost.replace(/,/g, ''))
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      errors.push({ row: rowNumber, reason: 'N열 원가가 올바른 숫자가 아닙니다.' })
      skipped += 1
      return
    }
    rows.push({ sku, costPrice, rowNumber })
  })

  return { rows, totalRows, skipped, errors }
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 10); rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    if (cellText(row.getCell(1).value) === '품목코드' && cellText(row.getCell(14).value).includes('원가')) {
      return rowNumber
    }
  }
  return null
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
  }
  return String(value).trim()
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
