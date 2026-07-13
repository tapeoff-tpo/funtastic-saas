import * as XLSX from 'xlsx'
import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analyticsPriceTableRows } from '@/lib/db/schema'

const TARGET_SHEETS = ['상품등록', '메인', '뉴도매']
const PAGE_SIZE = 100

export type PriceTableRow = typeof analyticsPriceTableRows.$inferSelect

export interface PriceTableImportResult {
  imported: number
  sheets: Array<{ name: string; rows: number }>
  sourceFileName: string
}

export interface PriceTableListResult {
  rows: PriceTableRow[]
  total: number
  overallTotal: number
  page: number
  pageSize: number
  sheets: string[]
  sheetCounts: Array<{ name: string; count: number }>
  latestImport: Date | null
  sourceFileName: string | null
}

type ParsedPriceTableRow = {
  sourceSheetName: string
  rowNumber: number
  productCode: string | null
  productName: string | null
  optionName: string | null
  registeredProductName: string | null
  rawData: Record<string, string>
}

let ensurePriceTableSchemaPromise: Promise<void> | null = null

export async function importPriceTableRows(data: {
  userId: string
  fileBuffer: ArrayBuffer
  sourceFileName: string
}): Promise<PriceTableImportResult> {
  await ensurePriceTableSchema()
  const parsed = parsePriceTableWorkbook(data.fileBuffer)
  const importedAt = new Date()

  await db.delete(analyticsPriceTableRows).where(eq(analyticsPriceTableRows.userId, data.userId))

  for (const chunk of chunks(parsed.rows, 500)) {
    await db.insert(analyticsPriceTableRows).values(chunk.map((row) => ({
      userId: data.userId,
      sourceFileName: data.sourceFileName,
      sourceSheetName: row.sourceSheetName,
      rowNumber: row.rowNumber,
      productCode: row.productCode,
      productName: row.productName,
      optionName: row.optionName,
      registeredProductName: row.registeredProductName,
      rawData: row.rawData,
      importedAt,
      updatedAt: importedAt,
    })))
  }

  return {
    imported: parsed.rows.length,
    sheets: parsed.sheets,
    sourceFileName: data.sourceFileName,
  }
}

export async function listPriceTableRows(data: {
  userId: string
  page?: number
  search?: string
  sheetName?: string
  sortKey?: string
  sortOrder?: 'asc' | 'desc'
}): Promise<PriceTableListResult> {
  await ensurePriceTableSchema()
  const page = Math.max(1, data.page ?? 1)
  const whereClause = buildWhereClause(data.userId, data.search, data.sheetName)
  const orderBy = buildOrderBy(data.sortKey, data.sortOrder)

  const [totalRows, rows, sheetRows, latestRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(analyticsPriceTableRows)
      .where(whereClause),
    db
      .select()
      .from(analyticsPriceTableRows)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ name: analyticsPriceTableRows.sourceSheetName, value: count() })
      .from(analyticsPriceTableRows)
      .where(eq(analyticsPriceTableRows.userId, data.userId))
      .groupBy(analyticsPriceTableRows.sourceSheetName)
      .orderBy(analyticsPriceTableRows.sourceSheetName),
    db
      .select({
        importedAt: analyticsPriceTableRows.importedAt,
        sourceFileName: analyticsPriceTableRows.sourceFileName,
      })
      .from(analyticsPriceTableRows)
      .where(eq(analyticsPriceTableRows.userId, data.userId))
      .orderBy(desc(analyticsPriceTableRows.importedAt))
      .limit(1),
  ])

  const total = totalRows[0]?.value ?? 0
  const latest = latestRows[0]
  const sheetCounts = sheetRows.map((row) => ({ name: row.name, count: row.value }))

  return {
    rows,
    total,
    overallTotal: sheetCounts.reduce((sum, sheet) => sum + sheet.count, 0),
    page,
    pageSize: PAGE_SIZE,
    sheets: sheetCounts.map((row) => row.name),
    sheetCounts,
    latestImport: latest?.importedAt ?? null,
    sourceFileName: latest?.sourceFileName ?? null,
  }
}

function parsePriceTableWorkbook(fileBuffer: ArrayBuffer): {
  rows: ParsedPriceTableRow[]
  sheets: Array<{ name: string; rows: number }>
} {
  const workbook = XLSX.read(fileBuffer, { type: 'array', cellDates: false })
  const rows: ParsedPriceTableRow[] = []
  const sheets: Array<{ name: string; rows: number }> = []

  for (const sheetName of TARGET_SHEETS) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    })
    const { headers, dataStartIndex } = sheetLayout(sheetName, matrix)
    let sheetRows = 0

    for (let index = dataStartIndex; index < matrix.length; index += 1) {
      const values = matrix[index] ?? []
      const rawData = rowToObject(headers, values)
      const nonEmptyCount = Object.values(rawData).filter(Boolean).length
      if (nonEmptyCount < 2) continue

      rows.push({
        sourceSheetName: sheetName,
        rowNumber: index + 1,
        productCode: pickValue(rawData, ['상품코드', '사방넷상품코드', '제품코드']),
        productName: pickValue(rawData, ['상품명', '상품약어', '모델명']),
        optionName: pickValue(rawData, ['옵션상세명칭', '옵션']),
        registeredProductName: pickValue(rawData, ['등록해야 할 상품명', '등록상품명']),
        rawData,
      })
      sheetRows += 1
    }

    sheets.push({ name: sheetName, rows: sheetRows })
  }

  if (rows.length === 0) {
    throw new Error('판매가 테이블에서 가져올 수 있는 상품 행을 찾지 못했습니다.')
  }

  return { rows, sheets }
}

function sheetLayout(sheetName: string, rows: Array<Array<string | number | boolean | null>>) {
  if (sheetName === '상품등록') {
    return { headers: buildMergedHeaders(rows, 1, 2), dataStartIndex: 3 }
  }
  if (sheetName === '메인' || sheetName === '뉴도매') {
    return { headers: buildMergedHeaders(rows, 0, 1), dataStartIndex: 2 }
  }
  return { headers: buildSingleHeaders(rows[0] ?? []), dataStartIndex: 1 }
}

function buildMergedHeaders(rows: Array<Array<string | number | boolean | null>>, groupIndex: number, fieldIndex: number) {
  const groupRow = rows[groupIndex] ?? []
  const fieldRow = rows[fieldIndex] ?? []
  const length = Math.max(groupRow.length, fieldRow.length)
  const headers: string[] = []
  let currentGroup = ''

  for (let index = 0; index < length; index += 1) {
    const group = cellText(groupRow[index])
    if (group) currentGroup = group
    const field = cellText(fieldRow[index])
    const header = field ? compactLabel(currentGroup, field) : currentGroup
    headers.push(header || `컬럼${index + 1}`)
  }

  return dedupeHeaders(headers)
}

function buildSingleHeaders(row: Array<string | number | boolean | null>) {
  return dedupeHeaders(row.map((cell, index) => cellText(cell) || `컬럼${index + 1}`))
}

function rowToObject(headers: string[], values: Array<string | number | boolean | null>) {
  const rawData: Record<string, string> = {}
  for (let index = 0; index < headers.length; index += 1) {
    const value = cellText(values[index])
    if (value) rawData[headers[index]] = value
  }
  return rawData
}

function pickValue(rawData: Record<string, string>, candidates: string[]) {
  for (const candidate of candidates) {
    const direct = rawData[candidate]
    if (direct) return direct
    const partial = Object.entries(rawData).find(([key, value]) => value && key.includes(candidate))?.[1]
    if (partial) return partial
  }
  return null
}

function compactLabel(group: string, field: string) {
  const cleanGroup = normalizeHeader(group)
  const cleanField = normalizeHeader(field)
  if (!cleanGroup || cleanGroup === cleanField || cleanField.includes(cleanGroup)) return cleanField
  return `${cleanGroup} ${cleanField}`
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function dedupeHeaders(headers: string[]) {
  const counts = new Map<string, number>()
  return headers.map((header) => {
    const count = counts.get(header) ?? 0
    counts.set(header, count + 1)
    return count === 0 ? header : `${header} ${count + 1}`
  })
}

function cellText(value: unknown) {
  if (value == null) return ''
  return String(value).replace(/\s+/g, ' ').trim()
}

function buildWhereClause(userId: string, search?: string, sheetName?: string) {
  const conditions = [eq(analyticsPriceTableRows.userId, userId)]
  const cleanSheet = sheetName?.trim()
  if (cleanSheet) conditions.push(eq(analyticsPriceTableRows.sourceSheetName, cleanSheet))

  const cleanSearch = search?.trim()
  if (cleanSearch) {
    const term = `%${cleanSearch}%`
    conditions.push(or(
      ilike(analyticsPriceTableRows.productCode, term),
      ilike(analyticsPriceTableRows.productName, term),
      ilike(analyticsPriceTableRows.optionName, term),
      ilike(analyticsPriceTableRows.registeredProductName, term),
      sql`${analyticsPriceTableRows.rawData}::text ILIKE ${term}`,
    )!)
  }

  return and(...conditions)!
}

function buildOrderBy(sortKey?: string, sortOrder?: 'asc' | 'desc') {
  const direction = sortOrder === 'desc' ? desc : asc
  const coreColumn = (() => {
    switch (sortKey) {
      case 'productCode': return analyticsPriceTableRows.productCode
      case 'productName': return analyticsPriceTableRows.productName
      case 'optionName': return analyticsPriceTableRows.optionName
      case 'registeredProductName': return analyticsPriceTableRows.registeredProductName
      case 'rowNumber': return analyticsPriceTableRows.rowNumber
      default: return null
    }
  })()

  if (coreColumn) {
    return [
      asc(sql`${coreColumn} IS NULL`),
      direction(coreColumn),
      asc(analyticsPriceTableRows.rowNumber),
    ]
  }

  const rawKey = sortKey?.startsWith('raw:') ? sortKey.slice(4).trim() : ''
  if (rawKey && rawKey.length <= 180) {
    const rawValue = sql<string>`NULLIF(${analyticsPriceTableRows.rawData} ->> ${rawKey}, '')`
    const numericValue = sql<number>`CASE
      WHEN ${rawValue} ~ '^-?[0-9]+([.][0-9]+)?$' THEN (${rawValue})::numeric
      ELSE NULL
    END`
    return [
      asc(sql`${rawValue} IS NULL`),
      direction(numericValue),
      direction(sql`LOWER(${rawValue})`),
      asc(analyticsPriceTableRows.rowNumber),
    ]
  }

  return [
    asc(analyticsPriceTableRows.sourceSheetName),
    asc(analyticsPriceTableRows.rowNumber),
  ]
}

async function ensurePriceTableSchema() {
  ensurePriceTableSchemaPromise ??= (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS analytics_price_table_rows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        source_file_name varchar(255),
        source_sheet_name varchar(100) NOT NULL,
        row_number integer NOT NULL,
        product_code varchar(100),
        product_name text,
        option_name text,
        registered_product_name text,
        raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS analytics_price_table_rows_user_imported_idx
      ON analytics_price_table_rows (user_id, imported_at)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS analytics_price_table_rows_user_sheet_idx
      ON analytics_price_table_rows (user_id, source_sheet_name)
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS analytics_price_table_rows_user_product_code_idx
      ON analytics_price_table_rows (user_id, product_code)
    `)
  })()
  return ensurePriceTableSchemaPromise
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
