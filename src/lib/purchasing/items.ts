import ExcelJS from 'exceljs'
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { getCoupangRocketOutgoingMetrics } from '@/lib/analytics/coupang-rocket-outbound'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'

export const PURCHASE_URL_HEADER = '구매 URL'

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
  PURCHASE_URL_HEADER,
] as const

export type Esa009mHeader = (typeof ESA009M_HEADERS)[number]
export type Esa009mData = Record<Esa009mHeader, string | null>
export type PurchasingItemSortDirection = 'asc' | 'desc'
export type PurchasingItemOutgoingMetrics = {
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
}
export type PurchaseUrlVerificationStatus = 'confirm_required' | null
export type PurchasingItemOutgoingMetricRow = PurchasingItemOutgoingMetrics & {
  internalSku: string
}
type PurchasingItemCurrentMonthReviewRow = {
  internalSku: string
  currentMonthOutgoing: number
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

export const PURCHASING_ITEM_DEFAULT_UPDATE_HEADERS = [
  '특가(元)',
  '신규원가(元)',
  '상품원가(元)',
  '배송비(元)',
  'works 기존 원가',
  'works 신규 원가',
  PURCHASE_URL_HEADER,
] as const satisfies readonly Esa009mHeader[]

export type PurchasingItemImportMode = 'cost-url-and-new' | 'new-only' | 'selected'

export type PurchasingItemImportOptions = {
  mode: PurchasingItemImportMode
  selectedHeaders?: Esa009mHeader[]
  createMissing?: boolean
}

export type PurchasingItemImportPreview = {
  total: number
  parsed: number
  skipped: number
  newItems: number
  updateItems: number
  changedItems: number
  unchangedItems: number
  skippedExisting: number
  invalidNewItems: number
  fieldChanges: Record<string, number>
  sampleChanges: Array<{
    sku: string
    name: string | null
    type: 'new' | 'update' | 'invalid-new'
    changedHeaders: string[]
  }>
}

type ParsedPurchasingItems = Awaited<ReturnType<typeof parseEsa009mWorkbook>>
type ExistingPurchasingItem = {
  id: string
  internalSku: string
  name: string
  metadata: Record<string, unknown> | null
}

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
      purchaseUrlVerificationStatus: purchaseUrlVerificationStatus(row.metadata),
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
    purchaseUrlVerificationStatus: purchaseUrlVerificationStatus(row.metadata),
    outgoingMetrics: metricsBySku.get(row.internalSku) ?? emptyOutgoingMetrics(),
    updatedAt: row.updatedAt,
  }))
}

export async function previewPurchasingItemsImport(input: {
  userId: string
  fileBuffer: ArrayBuffer
  options: PurchasingItemImportOptions
}) {
  const parsed = await parseEsa009mWorkbook(input.fileBuffer)
  const existingBySku = await getExistingPurchasingItemsBySku(input.userId, parsed.rows.map((row) => row['품목코드']).filter(Boolean) as string[])
  return buildPurchasingItemsImportPreview(parsed, existingBySku, normalizeImportOptions(input.options))
}

export async function importPurchasingItems(input: {
  userId: string
  fileBuffer: ArrayBuffer
  options?: PurchasingItemImportOptions
}) {
  const options = normalizeImportOptions(input.options)
  const parsed = await parseEsa009mWorkbook(input.fileBuffer)
  const existingBySku = await getExistingPurchasingItemsBySku(input.userId, parsed.rows.map((row) => row['품목코드']).filter(Boolean) as string[])
  const preview = buildPurchasingItemsImportPreview(parsed, existingBySku, options)
  let inserted = 0
  let updated = 0

  for (const row of parsed.rows) {
    const sku = row['품목코드']?.trim()
    if (!sku) continue
    const current = existingBySku.get(sku)

    if (!current) {
      if (!shouldCreateMissing(options)) continue
      const name = row['품목명']?.trim()
      if (!name) continue
      const nextData = mergeEsaData(normalizeEsaData({}), row, ESA009M_HEADERS, true)
      nextData['품목코드'] = sku
      nextData['품목명'] = name
      await db.insert(products).values({
        userId: input.userId,
        internalSku: sku,
        name,
        basePrice: '0',
        costPrice: numericText(nextData['works 신규 원가'] || nextData['works 기존 원가']),
        warehouseLocation: nextData['한국창고기준 위치'],
        status: 'active' as const,
        metadata: { esa009m: nextData },
      }).onConflictDoNothing()
      inserted += 1
      continue
    }

    if (options.mode === 'new-only') continue
    const headers = updateHeadersForImport(options)
    const currentData = normalizeEsaData(current.metadata?.esa009m)
    const nextData = mergeEsaData(currentData, row, headers, false)
    const changedHeaders = headers.filter((header) => currentData[header] !== nextData[header])
    if (changedHeaders.length === 0) continue

    const metadata = metadataWithPurchasingItemData(current.metadata, nextData)
    const set: Partial<typeof products.$inferInsert> = {
      metadata,
      updatedAt: new Date(),
    }
    if (changedHeaders.includes('품목명')) set.name = nextData['품목명'] || current.name
    if (changedHeaders.includes('한국창고기준 위치')) set.warehouseLocation = nextData['한국창고기준 위치']
    if (changedHeaders.includes('works 신규 원가') || changedHeaders.includes('works 기존 원가')) {
      set.costPrice = numericText(nextData['works 신규 원가'] || nextData['works 기존 원가'])
    }

    await db.update(products)
      .set(set)
      .where(and(eq(products.userId, input.userId), eq(products.internalSku, sku)))
    updated += 1
  }

  return { ...preview, inserted, updated, imported: inserted + updated }
}

export async function createPurchasingItem(input: {
  userId: string
  data: Partial<Record<Esa009mHeader, string | null>>
}) {
  const nextData = {
    ...normalizeEsaData({}),
    ...Object.fromEntries(
      Object.entries(input.data)
        .filter(([header]) => ESA009M_HEADERS.includes(header as Esa009mHeader))
        .map(([header, value]) => [header, value?.trim() || null]),
    ),
  } as Esa009mData

  const internalSku = nextData[ESA009M_HEADERS[0]]?.trim()
  const name = nextData[ESA009M_HEADERS[1]]?.trim()
  if (!internalSku || !name) {
    return { error: '품목코드와 품목명은 필수입니다.' as const }
  }

  nextData[ESA009M_HEADERS[0]] = internalSku
  nextData[ESA009M_HEADERS[1]] = name
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.userId, input.userId), eq(products.internalSku, internalSku)))
    .limit(1)

  if (existing) return { error: '이미 같은 품목코드가 있습니다.' as const }

  const [row] = await db
    .insert(products)
    .values({
      userId: input.userId,
      internalSku,
      name,
      basePrice: '0',
      costPrice: numericText(nextData[ESA009M_HEADERS[14]] || nextData[ESA009M_HEADERS[13]]),
      warehouseLocation: nextData[ESA009M_HEADERS[3]],
      status: 'active' as const,
      metadata: { esa009m: nextData },
    })
    .returning({
      id: products.id,
      updatedAt: products.updatedAt,
    })

  return { row }
}

export async function updatePurchasingItem(input: {
  userId: string
  id: string
  data: Partial<Record<Esa009mHeader, string | null>>
}) {
  const [current] = await db
    .select({
      id: products.id,
      internalSku: products.internalSku,
      name: products.name,
      metadata: products.metadata,
    })
    .from(products)
    .where(and(eq(products.userId, input.userId), eq(products.id, input.id)))
    .limit(1)

  if (!current) return null

  const nextData = {
    ...normalizeEsaData(current.metadata?.esa009m),
    ...Object.fromEntries(
      Object.entries(input.data)
        .filter(([header]) => ESA009M_HEADERS.includes(header as Esa009mHeader))
        .map(([header, value]) => [header, value?.trim() || null]),
    ),
  } as Esa009mData

  nextData[ESA009M_HEADERS[0]] = current.internalSku
  const nextName = nextData[ESA009M_HEADERS[1]] || current.name
  const warehouseLocation = nextData[ESA009M_HEADERS[3]]
  const costPrice = numericText(nextData[ESA009M_HEADERS[14]] || nextData[ESA009M_HEADERS[13]])
  const metadata = metadataWithPurchasingItemData(current.metadata, nextData)

  const [row] = await db
    .update(products)
    .set({
      name: nextName,
      costPrice,
      warehouseLocation,
      metadata,
      updatedAt: new Date(),
    })
    .where(and(eq(products.userId, input.userId), eq(products.id, input.id)))
    .returning({
      id: products.id,
      updatedAt: products.updatedAt,
    })

  return row ?? null
}

export async function parseEsa009mWorkbook(fileBuffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('엑셀 시트를 찾을 수 없습니다.')

  const headerRow = findHeaderRow(sheet)
  if (!headerRow) throw new Error('엑셀에서 품목코드 헤더를 찾을 수 없습니다.')
  const columnByHeader = new Map<string, number>()
  sheet.getRow(headerRow).eachCell((cell, column) => columnByHeader.set(cellText(cell.value), column))
  if (!columnByHeader.has('특가(元)') && columnByHeader.has('기존원가(元)')) {
    columnByHeader.set('특가(元)', columnByHeader.get('기존원가(元)')!)
  }
  if (!columnByHeader.has('품목코드')) throw new Error('필수 열이 없습니다: 품목코드')

  const rows: Esa009mData[] = []
  let total = 0
  let skipped = 0
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return
    const data = Object.fromEntries(ESA009M_HEADERS.map((header) => {
      const column = columnByHeader.get(header)
      const value = column ? cellText(row.getCell(column).value) : ''
      return [header, value || null]
    })) as Esa009mData
    if (!Object.values(data).some(Boolean)) return
    total += 1
    if (!data['품목코드']) {
      skipped += 1
      return
    }
    rows.push(data)
  })
  return { rows, total, skipped, headers: ESA009M_HEADERS.filter((header) => columnByHeader.has(header)) }
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const values = new Set<string>()
    sheet.getRow(rowNumber).eachCell((cell) => values.add(cellText(cell.value)))
    if (values.has('품목코드')) return rowNumber
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

  const {
    currentMonthStart,
    previousThreeMonthStart,
    nextMonthStart,
    previousThreeMonthDate,
    currentMonthDate,
    nextMonthDate,
  } = getOutgoingMetricWindows(now)
  const skuSql = sql.join(uniqueSkus.map((sku) => sql`${sku}`), sql`, `)
  const reviewDateExpression = sql`
    CASE
      WHEN raw_data->>'출고완료일자' ~ '^\\d{8}$' THEN to_date(raw_data->>'출고완료일자', 'YYYYMMDD')
      WHEN raw_data->>'출고완료일자' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(raw_data->>'출고완료일자', 10)::date
      WHEN parsed_data->>'orderedAt' ~ '^\\d{8}$' THEN to_date(parsed_data->>'orderedAt', 'YYYYMMDD')
      WHEN parsed_data->>'orderedAt' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(parsed_data->>'orderedAt', 10)::date
      WHEN raw_data->>'수집일자' ~ '^\\d{8}$' THEN to_date(raw_data->>'수집일자', 'YYYYMMDD')
      WHEN raw_data->>'수집일자' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(raw_data->>'수집일자', 10)::date
      ELSE NULL
    END
  `
  const [storedRows, result, currentMonthReviewResult, rocketOutgoingMetrics] = await Promise.all([
    db.select({
      internalSku: products.internalSku,
      metadata: products.metadata,
    }).from(products).where(and(
      eq(products.userId, userId),
      inArray(products.internalSku, uniqueSkus),
    )),
    db.execute<PurchasingItemOutgoingMetricRow>(sql`
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
    `),
    db.execute<PurchasingItemCurrentMonthReviewRow>(sql`
      WITH latest_current_month_batch AS (
        SELECT batch_id
        FROM sabangnet_review_lines
        WHERE user_id = ${userId}
          AND sku IN (${skuSql})
          AND ${reviewDateExpression} >= ${currentMonthDate}::date
          AND ${reviewDateExpression} < ${nextMonthDate}::date
        ORDER BY created_at DESC
        LIMIT 1
      )
      SELECT
        sku AS "internalSku",
        COALESCE(SUM(quantity), 0)::numeric AS "currentMonthOutgoing"
      FROM sabangnet_review_lines
      WHERE user_id = ${userId}
        AND sku IN (${skuSql})
        AND batch_id = (SELECT batch_id FROM latest_current_month_batch)
        AND ${reviewDateExpression} >= ${currentMonthDate}::date
        AND ${reviewDateExpression} < ${nextMonthDate}::date
      GROUP BY sku
    `),
    getCoupangRocketOutgoingMetrics({
      userId,
      skus: uniqueSkus,
      previousThreeMonthDate,
      currentMonthDate,
      nextMonthDate,
    }),
  ])

  const metricsBySku = new Map(resultRows<PurchasingItemOutgoingMetricRow>(result).map((row) => [
    row.internalSku,
    {
      currentMonthOutgoing: cleanOutgoingNumber(row.currentMonthOutgoing),
      threeMonthAverageOutgoing: cleanOutgoingNumber(row.threeMonthAverageOutgoing),
    },
  ]))
  for (const row of resultRows<PurchasingItemCurrentMonthReviewRow>(currentMonthReviewResult)) {
    const current = metricsBySku.get(row.internalSku) ?? emptyOutgoingMetrics()
    metricsBySku.set(row.internalSku, {
      ...current,
      currentMonthOutgoing: cleanOutgoingNumber(row.currentMonthOutgoing),
    })
  }
  for (const row of storedRows) {
    const calculated = metricsBySku.get(row.internalSku) ?? emptyOutgoingMetrics()
    metricsBySku.set(row.internalSku, resolveOutgoingMetrics(row.metadata, calculated))
  }
  // The stored average remains the established baseline; Rocket delivery is an additional source.
  for (const [sku, rocketMetrics] of rocketOutgoingMetrics) {
    const current = metricsBySku.get(sku) ?? emptyOutgoingMetrics()
    metricsBySku.set(sku, {
      currentMonthOutgoing: cleanOutgoingNumber(current.currentMonthOutgoing + rocketMetrics.currentMonthOutgoing),
      threeMonthAverageOutgoing: cleanOutgoingNumber(
        current.threeMonthAverageOutgoing + rocketMetrics.threeMonthAverageOutgoing,
      ),
    })
  }
  return metricsBySku
}

export function purchaseUrlVerificationStatus(metadata: unknown): PurchaseUrlVerificationStatus {
  const root = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
  const verification = root.purchaseUrlVerification
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return null
  return (verification as Record<string, unknown>).status === 'confirm_required'
    ? 'confirm_required'
    : null
}

export function purchaseUrlExportStatus(
  data: Pick<Esa009mData, typeof PURCHASE_URL_HEADER>,
  verificationStatus: PurchaseUrlVerificationStatus,
) {
  if (verificationStatus === 'confirm_required') return '확인 필요'
  return data[PURCHASE_URL_HEADER]?.trim() ? '등록됨' : 'URL 없음'
}

function metadataWithPurchasingItemData(metadata: unknown, esa009m: Esa009mData) {
  const root = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
  const hasReplacementUrl = Boolean(esa009m[PURCHASE_URL_HEADER]?.trim())
  const withoutVerification = { ...root }
  delete withoutVerification.purchaseUrlVerification
  return {
    ...(hasReplacementUrl ? withoutVerification : root),
    esa009m,
  }
}

export function resolveOutgoingMetrics(
  metadata: unknown,
  calculated: PurchasingItemOutgoingMetrics,
): PurchasingItemOutgoingMetrics {
  if (!metadata || typeof metadata !== 'object') return calculated
  const stored = (metadata as Record<string, unknown>).purchasingOutgoingMetrics
  if (!stored || typeof stored !== 'object') return calculated

  const values = stored as Record<string, unknown>
  const threeMonthAverageOutgoing = Number(values.threeMonthAverageOutgoing)
  if (
    !Number.isFinite(threeMonthAverageOutgoing)
    || threeMonthAverageOutgoing < 0
  ) {
    return calculated
  }
  return {
    currentMonthOutgoing: calculated.currentMonthOutgoing,
    threeMonthAverageOutgoing: cleanOutgoingNumber(threeMonthAverageOutgoing),
  }
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
      sql`${products.metadata}->'esa009m'->>${PURCHASE_URL_HEADER} ILIKE ${pattern}`,
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

async function getExistingPurchasingItemsBySku(userId: string, skus: string[]) {
  const existingBySku = new Map<string, ExistingPurchasingItem>()
  const uniqueSkus = Array.from(new Set(skus.map((sku) => sku.trim()).filter(Boolean)))
  for (const skuChunk of chunks(uniqueSkus, 500)) {
    const rows = await db.select({
      id: products.id,
      internalSku: products.internalSku,
      name: products.name,
      metadata: products.metadata,
    }).from(products).where(and(
      eq(products.userId, userId),
      inArray(products.internalSku, skuChunk),
    ))
    for (const row of rows) existingBySku.set(row.internalSku, row)
  }
  return existingBySku
}

function buildPurchasingItemsImportPreview(
  parsed: ParsedPurchasingItems,
  existingBySku: Map<string, ExistingPurchasingItem>,
  options: Required<PurchasingItemImportOptions>,
): PurchasingItemImportPreview {
  const headers = updateHeadersForImport(options).filter((header) => parsed.headers.includes(header))
  const fieldChanges = Object.fromEntries(headers.map((header) => [header, 0]))
  const sampleChanges: PurchasingItemImportPreview['sampleChanges'] = []
  let newItems = 0
  let updateItems = 0
  let changedItems = 0
  let unchangedItems = 0
  let skippedExisting = 0
  let invalidNewItems = 0

  for (const row of parsed.rows) {
    const sku = row['품목코드']?.trim()
    if (!sku) continue
    const current = existingBySku.get(sku)
    if (!current) {
      if (!shouldCreateMissing(options)) continue
      if (!row['품목명']?.trim()) {
        invalidNewItems += 1
        pushSample(sampleChanges, {
          sku,
          name: null,
          type: 'invalid-new',
          changedHeaders: ['품목명 필요'],
        })
        continue
      }
      newItems += 1
      pushSample(sampleChanges, {
        sku,
        name: row['품목명'],
        type: 'new',
        changedHeaders: parsed.headers.filter((header) => Boolean(row[header])),
      })
      continue
    }

    if (options.mode === 'new-only') {
      skippedExisting += 1
      continue
    }

    updateItems += 1
    const currentData = normalizeEsaData(current.metadata?.esa009m)
    const nextData = mergeEsaData(currentData, row, headers, false)
    const changedHeaders = headers.filter((header) => currentData[header] !== nextData[header])
    if (changedHeaders.length === 0) {
      unchangedItems += 1
      continue
    }
    changedItems += 1
    for (const header of changedHeaders) fieldChanges[header] = (fieldChanges[header] ?? 0) + 1
    pushSample(sampleChanges, {
      sku,
      name: row['품목명'] || current.name,
      type: 'update',
      changedHeaders,
    })
  }

  return {
    total: parsed.total,
    parsed: parsed.rows.length,
    skipped: parsed.skipped,
    newItems,
    updateItems,
    changedItems,
    unchangedItems,
    skippedExisting,
    invalidNewItems,
    fieldChanges,
    sampleChanges,
  }
}

function normalizeImportOptions(options?: PurchasingItemImportOptions): Required<PurchasingItemImportOptions> {
  const mode = options?.mode ?? 'cost-url-and-new'
  const selectedHeaders = (options?.selectedHeaders ?? [])
    .filter((header): header is Esa009mHeader => ESA009M_HEADERS.includes(header))
  return {
    mode,
    selectedHeaders,
    createMissing: options?.createMissing ?? mode !== 'selected',
  }
}

function updateHeadersForImport(options: Required<PurchasingItemImportOptions>): Esa009mHeader[] {
  if (options.mode === 'new-only') return []
  if (options.mode === 'selected') {
    return Array.from(new Set(options.selectedHeaders.filter((header) => header !== '품목코드')))
  }
  return [...PURCHASING_ITEM_DEFAULT_UPDATE_HEADERS]
}

function shouldCreateMissing(options: Required<PurchasingItemImportOptions>) {
  return options.mode === 'new-only' || options.createMissing
}

function mergeEsaData(
  current: Esa009mData,
  incoming: Esa009mData,
  headers: readonly Esa009mHeader[],
  includeBlank: boolean,
) {
  const next = { ...current }
  for (const header of headers) {
    const value = incoming[header]?.trim() || null
    if (!includeBlank && value == null) continue
    next[header] = value
  }
  return next
}

function pushSample(
  samples: PurchasingItemImportPreview['sampleChanges'],
  sample: PurchasingItemImportPreview['sampleChanges'][number],
) {
  if (samples.length < 8) samples.push(sample)
}

function cleanOutgoingNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.round(number * 10) / 10)
}

function emptyOutgoingMetrics(): PurchasingItemOutgoingMetrics {
  return { currentMonthOutgoing: 0, threeMonthAverageOutgoing: 0 }
}

export function getOutgoingMetricWindows(now: Date) {
  const seoulNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const year = seoulNow.getUTCFullYear()
  const month = seoulNow.getUTCMonth()
  const seoulMonthStart = (monthOffset: number) => (
    new Date(Date.UTC(year, month + monthOffset, 1) - 9 * 60 * 60 * 1000)
  )
  const monthDate = (monthOffset: number) => (
    new Date(Date.UTC(year, month + monthOffset, 1)).toISOString().slice(0, 10)
  )

  return {
    currentMonthStart: seoulMonthStart(0),
    previousThreeMonthStart: seoulMonthStart(-3),
    nextMonthStart: seoulMonthStart(1),
    previousThreeMonthDate: monthDate(-3),
    currentMonthDate: monthDate(0),
    nextMonthDate: monthDate(1),
  }
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
