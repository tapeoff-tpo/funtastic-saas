import ExcelJS from 'exceljs'
import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'

export const ESA009M_HEADERS = [
  '품목코드',
  '품목명',
  '규격정보',
  '한국창고기준 위치',
  '영문명',
  '검역대상 여부',
  '100KG 인증여부',
  'HS CODE',
  '재질',
  '특가(元)',
  '신규원가(元)',
  '상품원가(元)',
  '배송비(元)',
  'works 기존 원가',
  'works 신규 원가',
  '품목구분',
  '매입부가세',
  '보통영수증 (%)',
  '증취세영수증  (%)',
] as const

export type Esa009mHeader = (typeof ESA009M_HEADERS)[number]
export type Esa009mData = Record<Esa009mHeader, string | null>
export type PurchasingItemSortDirection = 'asc' | 'desc'
export type PurchasingItemOutgoingMetrics = {
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
}
export type PurchasingItemOutgoingMetricRow = PurchasingItemOutgoingMetrics & {
  internalSku: string
}

const NUMERIC_HEADERS = new Set<Esa009mHeader>([
  '특가(元)',
  '신규원가(元)',
  '상품원가(元)',
  '배송비(元)',
  'works 기존 원가',
  'works 신규 원가',
  '매입부가세',
  '보통영수증 (%)',
  '증취세영수증  (%)',
])

export async function getPurchasingItems(input: {
  userId: string
  page: number
  pageSize: number
  search?: string
  filters?: Partial<Record<Esa009mHeader, string>>
  sort?: Esa009mHeader | 'updatedAt'
  direction?: PurchasingItemSortDirection
}) {
  const conditions = purchasingItemConditions(input.userId, input.search, input.filters)
  const orderBy = purchasingItemOrderBy(input.sort, input.direction)
  const where = and(...conditions)
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: products.id,
      internalSku: products.internalSku,
      metadata: products.metadata,
      updatedAt: products.updatedAt,
    }).from(products).where(where).orderBy(orderBy)
      .limit(input.pageSize).offset((input.page - 1) * input.pageSize),
    db.select({ total: count() }).from(products).where(where),
  ])

  const metricsBySku = await getSkuOutgoingMetrics(input.userId, rows.map((row) => row.internalSku))

  return {
    items: rows.map((row) => ({
      id: row.id,
      data: normalizeEsaData(row.metadata?.esa009m),
      outgoingMetrics: metricsBySku.get(row.internalSku) ?? emptyOutgoingMetrics(),
      updatedAt: row.updatedAt,
    })),
    total,
  }
}

export async function getAllPurchasingItems(userId: string) {
  const rows = await db.select({
    id: products.id,
    internalSku: products.internalSku,
    metadata: products.metadata,
    updatedAt: products.updatedAt,
  }).from(products)
    .where(and(...purchasingItemConditions(userId)))
    .orderBy(asc(products.internalSku))

  const metricsBySku = await getSkuOutgoingMetrics(userId, rows.map((row) => row.internalSku))

  return rows.map((row) => ({
    id: row.id,
    data: normalizeEsaData(row.metadata?.esa009m),
    outgoingMetrics: metricsBySku.get(row.internalSku) ?? emptyOutgoingMetrics(),
    updatedAt: row.updatedAt,
  }))
}

export async function importPurchasingItems(input: { userId: string; fileBuffer: ArrayBuffer }) {
  const parsed = await parseEsa009mWorkbook(input.fileBuffer)
  for (const chunk of chunks(parsed.rows, 250)) {
    await db.insert(products).values(chunk.map((row) => ({
      userId: input.userId,
      internalSku: row['품목코드']!,
      name: row['품목명'] || row['품목코드']!,
      basePrice: '0',
      costPrice: numericText(row['works 신규 원가'] || row['works 기존 원가']),
      warehouseLocation: row['한국창고기준 위치'],
      status: 'active' as const,
      metadata: { esa009m: row },
    }))).onConflictDoUpdate({
      target: [products.userId, products.internalSku],
      set: {
        name: sql`excluded.name`,
        costPrice: sql`excluded.cost_price`,
        warehouseLocation: sql`excluded.warehouse_location`,
        metadata: sql`COALESCE(${products.metadata}, '{}'::jsonb) || excluded.metadata`,
        updatedAt: sql`NOW()`,
      },
    })
  }
  return { total: parsed.total, imported: parsed.rows.length, skipped: parsed.skipped }
}

export async function parseEsa009mWorkbook(fileBuffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('엑셀 시트를 찾을 수 없습니다.')

  const headerRow = findHeaderRow(sheet)
  if (!headerRow) throw new Error('ESA009M 품목코드/품목명 헤더를 찾을 수 없습니다.')
  const columnByHeader = new Map<string, number>()
  sheet.getRow(headerRow).eachCell((cell, column) => columnByHeader.set(cellText(cell.value), column))
  if (!columnByHeader.has('특가(元)') && columnByHeader.has('기존원가(元)')) {
    columnByHeader.set('특가(元)', columnByHeader.get('기존원가(元)')!)
  }
  const missing = ESA009M_HEADERS.filter((header) => !columnByHeader.has(header))
  if (missing.length > 0) throw new Error(`필수 열이 없습니다: ${missing.join(', ')}`)

  const rows: Esa009mData[] = []
  let total = 0
  let skipped = 0
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return
    const data = Object.fromEntries(ESA009M_HEADERS.map((header) => {
      const value = cellText(row.getCell(columnByHeader.get(header)!).value)
      return [header, value || null]
    })) as Esa009mData
    if (!Object.values(data).some(Boolean)) return
    total += 1
    if (!data['품목코드'] || !data['품목명']) {
      skipped += 1
      return
    }
    rows.push(data)
  })
  return { rows, total, skipped }
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const values = new Set<string>()
    sheet.getRow(rowNumber).eachCell((cell) => values.add(cellText(cell.value)))
    if (values.has('품목코드') && values.has('품목명')) return rowNumber
  }
  return null
}

function normalizeEsaData(value: unknown): Esa009mData {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(ESA009M_HEADERS.map((header) => [
    header,
    source[header] == null ? null : String(source[header]),
  ])) as Esa009mData
}

export async function getSkuOutgoingMetrics(
  userId: string,
  skus: string[],
  now = new Date(),
): Promise<Map<string, PurchasingItemOutgoingMetrics>> {
  const uniqueSkus = Array.from(new Set(skus.filter(Boolean)))
  if (uniqueSkus.length === 0) return new Map()

  const { currentMonthStart, previousThreeMonthStart, nextMonthStart } = getOutgoingMetricWindows(now)
  const skuSql = sql.join(uniqueSkus.map((sku) => sql`${sku}`), sql`, `)
  const result = await db.execute<PurchasingItemOutgoingMetricRow>(sql`
    SELECT
      COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) AS "internalSku",
      COALESCE(SUM(
        CASE
          WHEN o.ordered_at >= ${currentMonthStart.toISOString()}::timestamptz
           AND o.ordered_at < ${nextMonthStart.toISOString()}::timestamptz
          THEN COALESCE(oi.locked_quantity, oi.quantity * COALESCE(oi.sku_multiplier, 1))
          ELSE 0
        END
      ), 0)::numeric AS "currentMonthOutgoing",
      (COALESCE(SUM(
        CASE
          WHEN o.ordered_at >= ${previousThreeMonthStart.toISOString()}::timestamptz
           AND o.ordered_at < ${currentMonthStart.toISOString()}::timestamptz
          THEN COALESCE(oi.locked_quantity, oi.quantity * COALESCE(oi.sku_multiplier, 1))
          ELSE 0
        END
      ), 0) / 3.0)::numeric AS "threeMonthAverageOutgoing"
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.user_id = ${userId}
      AND o.raw_data->>'source' = 'sabangnet-review'
      AND o.ordered_at >= ${previousThreeMonthStart.toISOString()}::timestamptz
      AND o.ordered_at < ${nextMonthStart.toISOString()}::timestamptz
      AND COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) IN (${skuSql})
    GROUP BY COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
  `)

  return new Map(resultRows<PurchasingItemOutgoingMetricRow>(result).map((row) => [
    row.internalSku,
    {
      currentMonthOutgoing: cleanOutgoingNumber(row.currentMonthOutgoing),
      threeMonthAverageOutgoing: cleanOutgoingNumber(row.threeMonthAverageOutgoing),
    },
  ]))
}

function purchasingItemConditions(
  userId: string,
  search?: string,
  filters?: Partial<Record<Esa009mHeader, string>>,
) {
  const conditions = [
    eq(products.userId, userId),
    sql`${products.metadata}->'esa009m' IS NOT NULL`,
  ]
  if (search) {
    const pattern = `%${search}%`
    conditions.push(or(
      ilike(products.internalSku, pattern),
      ilike(products.name, pattern),
      sql`${products.metadata}->'esa009m'->>'영문명' ILIKE ${pattern}`,
      sql`${products.metadata}->'esa009m'->>'HS CODE' ILIKE ${pattern}`,
    )!)
  }
  for (const header of ESA009M_HEADERS) {
    const value = filters?.[header]?.trim()
    if (value) conditions.push(sql`${products.metadata}->'esa009m'->>${header} ILIKE ${`%${value}%`}`)
  }
  return conditions
}

function purchasingItemOrderBy(
  sort: Esa009mHeader | 'updatedAt' = '품목코드',
  direction: PurchasingItemSortDirection = 'asc',
) {
  const field = sort === 'updatedAt'
    ? products.updatedAt
    : NUMERIC_HEADERS.has(sort)
      ? sql<number>`NULLIF(regexp_replace(COALESCE(${products.metadata}->'esa009m'->>${sort}, ''), '[^0-9.-]', '', 'g'), '')::numeric`
      : sql<string>`COALESCE(${products.metadata}->'esa009m'->>${sort}, '')`
  return direction === 'desc' ? desc(field) : asc(field)
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim()
  }
  return String(value).trim()
}

function numericText(value: string | null): string | null {
  if (!value) return null
  const number = Number(value.replace(/,/g, ''))
  return Number.isFinite(number) ? String(number) : null
}

function cleanOutgoingNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.round(number * 10) / 10)
}

function emptyOutgoingMetrics(): PurchasingItemOutgoingMetrics {
  return { currentMonthOutgoing: 0, threeMonthAverageOutgoing: 0 }
}

function getOutgoingMetricWindows(now: Date) {
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const previousThreeMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { currentMonthStart, previousThreeMonthStart, nextMonthStart }
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: T[] }).rows
  }
  return []
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
