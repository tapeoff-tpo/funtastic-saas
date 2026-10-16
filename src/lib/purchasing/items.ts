import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
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
  '제품크기',
  '제조사',
  '무게',
  '제조국',
  '용량',
  '[식약처]유리/도자기제품 필수확인',
  '구성품',
  '특이사항',
  '특가(元)',
  '신규원가(元)',
  '상품원가(元)',
  '배송비(元)',
  'works 기존 원가',
  'works 신규 원가',
  '기준환율',
  'B2B옵션추가금',
  'B2C옵션추가금',
  '구매참고사항',
  '품목구분',
  '매입부가세',
  '보통영수증 (%)',
  '증취세영수증  (%)',
  PURCHASE_URL_HEADER,
] as const

export type Esa009mHeader = (typeof ESA009M_HEADERS)[number]
export type Esa009mData = Record<Esa009mHeader, string | null>
export type PurchasingItemSortDirection = 'asc' | 'desc'
export type PurchasingSpecialBulkOutgoingAdjustment = {
  specialMall: string
  policy: string
  sourceMonths: string[]
  rawThreeMonthAverageOutgoing: number
  specialBulkQuantity: number
  specialBulkMonthCount: number
  specialBulkIncludedQuantity: number
  specialBulkExcludedQuantity: number
  adjustedThreeMonthAverageOutgoing: number
}
export type PurchasingItemOutgoingMetrics = {
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
  specialBulkOutgoingAdjustment?: PurchasingSpecialBulkOutgoingAdjustment | null
}
export type AverageSalesWorkbookRow = {
  internalSku: string
  currentMonthWorkbookOutgoing: number
  completedMonthOutgoing: Record<string, number>
  threeMonthSales: number
  threeMonthAverageOutgoing: number
}
export type ParsedAverageSalesWorkbook = {
  referenceMonth: string
  completedMonths: [string, string, string]
  rows: AverageSalesWorkbookRow[]
}
export type PurchasingRollingAverageBaseline = {
  source: 'average_sales_workbook'
  sourceFileName: string
  sourceFileHash: string
  importedAt: string
  referenceMonth: string
  completedMonthOutgoing: Record<string, number>
  threeMonthSales: number
  threeMonthAverageOutgoing: number
  currentMonthWorkbookOutgoing: number
}
export type PurchaseUrlVerificationStatus = 'confirm_required' | null
export type PurchaseUrlVerification = {
  status: 'confirm_required'
  reason: string | null
  checkedAt: string | null
} | null
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
  '기준환율',
  'B2B옵션추가금',
  'B2C옵션추가금',
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
  includeOutgoingMetrics?: boolean
}) {
  const conditions = purchasingItemConditions(input.userId, input.search, input.filters)
  const orderBy = purchasingItemOrderBy(input.sort, input.direction)
  const where = and(...conditions)
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: products.id,
      internalSku: products.internalSku,
      metadata: products.metadata,
      purchasingStatus: products.purchasingStatus,
      purchasingStatusNote: products.purchasingStatusNote,
      updatedAt: products.updatedAt,
    }).from(products).where(where).orderBy(orderBy)
      .limit(input.pageSize).offset((input.page - 1) * input.pageSize),
    db.select({ total: count() }).from(products).where(where),
  ])

  const metricsBySku = input.includeOutgoingMetrics
    ? await getSkuOutgoingMetrics(input.userId, rows.map((row) => row.internalSku))
    : null

  return {
    items: rows.map((row) => ({
      id: row.id,
      data: normalizeEsaData(row.metadata?.esa009m),
      purchaseUrlVerificationStatus: purchaseUrlVerificationStatus(row.metadata),
      purchaseUrlVerification: purchaseUrlVerification(row.metadata),
      purchasingStatus: row.purchasingStatus,
      purchasingStatusNote: row.purchasingStatusNote,
      outgoingMetrics: metricsBySku?.get(row.internalSku) ?? emptyOutgoingMetrics(),
      updatedAt: row.updatedAt,
    })),
    total,
  }
}

export async function getAllPurchasingItems(
  userId: string,
  options: { includeOutgoingMetrics?: boolean } = {},
) {
  const rows = await db.select({
    id: products.id,
    internalSku: products.internalSku,
    metadata: products.metadata,
    purchasingStatus: products.purchasingStatus,
    purchasingStatusNote: products.purchasingStatusNote,
    updatedAt: products.updatedAt,
  }).from(products)
    .where(and(...purchasingItemConditions(userId)))
    .orderBy(asc(products.internalSku))

  const metricsBySku = options.includeOutgoingMetrics
    ? await getSkuOutgoingMetrics(userId, rows.map((row) => row.internalSku))
    : null

  return rows.map((row) => ({
    id: row.id,
    data: normalizeEsaData(row.metadata?.esa009m),
    purchaseUrlVerificationStatus: purchaseUrlVerificationStatus(row.metadata),
    purchaseUrlVerification: purchaseUrlVerification(row.metadata),
    purchasingStatus: row.purchasingStatus,
    purchasingStatusNote: row.purchasingStatusNote,
    outgoingMetrics: metricsBySku?.get(row.internalSku) ?? emptyOutgoingMetrics(),
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
    const nextData = ensurePurchasingItemIdentity(
      mergeEsaData(currentData, row, headers, false),
      current,
    )
    const changedHeaders = headers.filter((header) => currentData[header] !== nextData[header])
    const identityChanged = purchasingItemIdentityChangedHeaders(currentData, nextData)
    if (changedHeaders.length === 0 && identityChanged.length === 0) continue

    const metadata = metadataWithPurchasingItemData(current.metadata, nextData)
    const set: Partial<typeof products.$inferInsert> = {
      metadata,
      updatedAt: new Date(),
    }
    if (changedHeaders.includes('품목명') || identityChanged.includes('품목명')) {
      set.name = nextData['품목명'] || current.name
    }
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

  const internalSku = nextData['품목코드']?.trim()
  const name = nextData['품목명']?.trim()
  if (!internalSku || !name) {
    return { error: '품목코드와 품목명은 필수입니다.' as const }
  }

  nextData['품목코드'] = internalSku
  nextData['품목명'] = name
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
      costPrice: numericText(nextData['works 신규 원가'] || nextData['works 기존 원가']),
      warehouseLocation: nextData['한국창고기준 위치'],
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

  const mergedData = {
    ...normalizeEsaData(current.metadata?.esa009m),
    ...Object.fromEntries(
      Object.entries(input.data)
        .filter(([header]) => ESA009M_HEADERS.includes(header as Esa009mHeader))
        .map(([header, value]) => [header, value?.trim() || null]),
    ),
  } as Esa009mData

  const nextData = ensurePurchasingItemIdentity(mergedData, current)
  const nextName = nextData['품목명']
  const warehouseLocation = nextData['한국창고기준 위치']
  const costPrice = numericText(nextData['works 신규 원가'] || nextData['works 기존 원가'])
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

/**
 * Reads the supplier-maintained monthly sales workbook. Its three completed
 * months are authoritative only for the workbook's reference month; after
 * that, the live outbound-reflection ledger provides the rolling window.
 */
export async function parseAverageSalesWorkbook(fileBuffer: ArrayBuffer): Promise<ParsedAverageSalesWorkbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('평균판매 엑셀 시트를 찾을 수 없습니다.')

  const headerRowNumber = findAverageSalesHeaderRow(sheet)
  if (!headerRowNumber) throw new Error('평균판매 엑셀에서 사방넷상품코드 헤더를 찾을 수 없습니다.')

  let skuColumn: number | null = null
  let threeMonthSalesColumn: number | null = null
  const monthColumns = new Map<string, number>()
  const headerRow = sheet.getRow(headerRowNumber)
  headerRow.eachCell((cell, column) => {
    const header = normalizeAverageSalesHeader(cellText(cell.value))
    if (header.startsWith('사방넷상품코드')) skuColumn = column
    if (header === '3개월판매') threeMonthSalesColumn = column

    const month = workbookMonthKey(cell.value)
    if (!month) return
    if (monthColumns.has(month)) throw new Error(`평균판매 엑셀에 중복된 월 헤더가 있습니다: ${month}`)
    monthColumns.set(month, column)
  })

  if (!skuColumn) throw new Error('평균판매 엑셀에 사방넷상품코드 열이 없습니다.')
  if (!threeMonthSalesColumn) throw new Error('평균판매 엑셀에 3개월판매 열이 없습니다.')
  const referenceMonth = Array.from(monthColumns.keys()).sort().at(-1)
  if (!referenceMonth) throw new Error('평균판매 엑셀에서 월별 출고수량 열을 찾을 수 없습니다.')

  const completedMonths = previousMonthKeys(referenceMonth, 3)
  const missingMonths = completedMonths.filter((month) => !monthColumns.has(month))
  if (missingMonths.length > 0) {
    throw new Error(`평균판매 엑셀에 직전 3개월 출고수량 열이 없습니다: ${missingMonths.join(', ')}`)
  }

  const rows: AverageSalesWorkbookRow[] = []
  const rowNumbersBySku = new Map<string, number>()
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const internalSku = cellText(row.getCell(skuColumn).value)
    if (!internalSku) continue
    if (rowNumbersBySku.has(internalSku)) {
      throw new Error(`평균판매 엑셀에 중복 품목코드가 있습니다: ${internalSku} (${rowNumbersBySku.get(internalSku)}행, ${rowNumber}행)`)
    }
    rowNumbersBySku.set(internalSku, rowNumber)

    const completedMonthOutgoing = Object.fromEntries(completedMonths.map((month) => [
      month,
      averageSalesQuantity(row.getCell(monthColumns.get(month)!).value, `${internalSku} ${month}`),
    ]))
    const expectedThreeMonthSales = Object.values(completedMonthOutgoing)
      .reduce((total, quantity) => total + quantity, 0)
    const threeMonthSales = averageSalesQuantity(
      row.getCell(threeMonthSalesColumn).value,
      `${internalSku} 3개월판매`,
    )
    if (Math.abs(threeMonthSales - expectedThreeMonthSales) > 0.001) {
      throw new Error(`${internalSku}: 3개월판매(${threeMonthSales})가 직전 3개월 합계(${expectedThreeMonthSales})와 다릅니다.`)
    }

    rows.push({
      internalSku,
      currentMonthWorkbookOutgoing: averageSalesQuantity(
        row.getCell(monthColumns.get(referenceMonth)!).value,
        `${internalSku} ${referenceMonth}`,
      ),
      completedMonthOutgoing,
      threeMonthSales,
      threeMonthAverageOutgoing: cleanOutgoingNumber(threeMonthSales / 3),
    })
  }

  return {
    referenceMonth,
    completedMonths: completedMonths as [string, string, string],
    rows,
  }
}

export async function applyAverageSalesBaseline(input: {
  userId: string
  fileName: string
  fileBuffer: ArrayBuffer
  importedAt?: Date
}) {
  const parsed = await parseAverageSalesWorkbook(input.fileBuffer)
  const existingBySku = await getExistingPurchasingItemsBySku(
    input.userId,
    parsed.rows.map((row) => row.internalSku),
  )
  const missingSkus = parsed.rows
    .map((row) => row.internalSku)
    .filter((sku) => !existingBySku.has(sku))
  if (missingSkus.length > 0) {
    throw new Error(`등록되지 않은 품목코드가 있습니다: ${missingSkus.slice(0, 20).join(', ')}${missingSkus.length > 20 ? ` 외 ${missingSkus.length - 20}건` : ''}`)
  }

  const importedAt = input.importedAt ?? new Date()
  const importedAtIso = importedAt.toISOString()
  const sourceFileHash = createHash('sha256').update(Buffer.from(input.fileBuffer)).digest('hex')
  let updated = 0

  await db.transaction(async (tx) => {
    for (const rowChunk of chunks(parsed.rows, 200)) {
      const baselineValues = sql.join(rowChunk.map((row) => {
        const baseline: PurchasingRollingAverageBaseline = {
          source: 'average_sales_workbook',
          sourceFileName: input.fileName,
          sourceFileHash,
          importedAt: importedAtIso,
          referenceMonth: parsed.referenceMonth,
          completedMonthOutgoing: row.completedMonthOutgoing,
          threeMonthSales: row.threeMonthSales,
          threeMonthAverageOutgoing: row.threeMonthAverageOutgoing,
          currentMonthWorkbookOutgoing: row.currentMonthWorkbookOutgoing,
        }
        return sql`(${row.internalSku}, ${JSON.stringify(baseline)}::jsonb)`
      }), sql`, `)
      const result = await tx.execute<{ internalSku: string }>(sql`
        UPDATE products AS product
        SET metadata = jsonb_set(
          COALESCE(product.metadata, '{}'::jsonb),
          '{purchasingRollingAverageBaseline}',
          baseline.data,
          true
        ),
        updated_at = ${importedAtIso}::timestamptz
        FROM (VALUES ${baselineValues}) AS baseline(internal_sku, data)
        WHERE product.user_id = ${input.userId}::uuid
          AND product.internal_sku = baseline.internal_sku
        RETURNING product.internal_sku AS "internalSku"
      `)
      const updatedRows = resultRows<{ internalSku: string }>(result)
      if (updatedRows.length !== rowChunk.length) {
        throw new Error(`평균판매 기준값 저장 중 일부 품목을 찾지 못했습니다. (${updatedRows.length}/${rowChunk.length})`)
      }
      updated += updatedRows.length
    }
  })

  return {
    updated,
    referenceMonth: parsed.referenceMonth,
    completedMonths: parsed.completedMonths,
    sourceFileHash,
  }
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const values = new Set<string>()
    sheet.getRow(rowNumber).eachCell((cell) => values.add(cellText(cell.value)))
    if (values.has('품목코드')) return rowNumber
  }
  return null
}

function findAverageSalesHeaderRow(sheet: ExcelJS.Worksheet): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    let hasSkuHeader = false
    sheet.getRow(rowNumber).eachCell((cell) => {
      if (normalizeAverageSalesHeader(cellText(cell.value)).startsWith('사방넷상품코드')) {
        hasSkuHeader = true
      }
    })
    if (hasSkuHeader) return rowNumber
  }
  return null
}

function normalizeAverageSalesHeader(value: string) {
  return value.replace(/\s+/g, '').trim()
}

function workbookMonthKey(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) return monthKeyFromDate(value)
  if (typeof value === 'number' && Number.isFinite(value) && value >= 30_000) {
    return monthKeyFromDate(new Date(Date.UTC(1899, 11, 30) + value * 24 * 60 * 60 * 1000))
  }

  const dateMatch = cellText(value).match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?/)
  if (!dateMatch) return null
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  if (month < 1 || month > 12) return null
  return `${year}-${String(month).padStart(2, '0')}`
}

function monthKeyFromDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function previousMonthKeys(referenceMonth: string, count: number): string[] {
  const match = referenceMonth.match(/^(\d{4})-(\d{2})$/)
  if (!match) throw new Error(`잘못된 기준월입니다: ${referenceMonth}`)
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex - count + index, 1))
    return monthKeyFromDate(date)
  })
}

function averageSalesQuantity(value: ExcelJS.CellValue, label: string): number {
  const text = cellText(value).replace(/,/g, '')
  if (!text || text === '-') return 0
  const quantity = Number(text)
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`${label}의 출고수량이 올바른 숫자가 아닙니다.`)
  }
  return quantity
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
    previousThreeMonthDate,
    currentMonthDate,
    nextMonthDate,
  } = getOutgoingMetricWindows(now)
  const skuSql = sql.join(uniqueSkus.map((sku) => sql`${sku}`), sql`, `)
  const [storedRows, result] = await Promise.all([
    db.select({
      internalSku: products.internalSku,
      metadata: products.metadata,
    }).from(products).where(and(
      eq(products.userId, userId),
      inArray(products.internalSku, uniqueSkus),
    )),
    db.execute<PurchasingItemOutgoingMetricRow>(sql`
      SELECT
        line.sku AS "internalSku",
        COALESCE(SUM(
          CASE
            WHEN line.shipment_date >= ${currentMonthDate}::date
             AND line.shipment_date < ${nextMonthDate}::date
            THEN CASE WHEN line.claim_type = 'return' THEN -line.quantity ELSE line.quantity END
            ELSE 0
          END
        ), 0)::numeric AS "currentMonthOutgoing",
        (COALESCE(SUM(
          CASE
            WHEN line.shipment_date >= ${previousThreeMonthDate}::date
             AND line.shipment_date < ${currentMonthDate}::date
            THEN CASE WHEN line.claim_type = 'return' THEN -line.quantity ELSE line.quantity END
            ELSE 0
          END
        ), 0) / 3.0)::numeric AS "threeMonthAverageOutgoing"
      FROM outbound_reflection_lines line
      WHERE line.user_id = ${userId}::uuid
        AND line.reflection_status = 'applied'
        AND line.shipment_date >= ${previousThreeMonthDate}::date
        AND line.shipment_date < ${nextMonthDate}::date
        AND line.sku IN (${skuSql})
      GROUP BY line.sku
    `),
  ])

  const metricsBySku = new Map(resultRows<PurchasingItemOutgoingMetricRow>(result).map((row) => [
    row.internalSku,
    {
      currentMonthOutgoing: cleanOutgoingNumber(row.currentMonthOutgoing),
      threeMonthAverageOutgoing: cleanOutgoingNumber(row.threeMonthAverageOutgoing),
    },
  ]))
  for (const row of storedRows) {
    const calculated = metricsBySku.get(row.internalSku) ?? emptyOutgoingMetrics()
    metricsBySku.set(
      row.internalSku,
      resolveOutgoingMetrics(row.metadata, calculated, currentMonthDate.slice(0, 7)),
    )
  }
  return metricsBySku
}

export function purchaseUrlVerificationStatus(metadata: unknown): PurchaseUrlVerificationStatus {
  return purchaseUrlVerification(metadata)?.status ?? null
}

export function purchaseUrlVerification(metadata: unknown): PurchaseUrlVerification {
  const root = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
  const verification = root.purchaseUrlVerification
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return null
  const details = verification as Record<string, unknown>
  if (details.status !== 'confirm_required') return null
  return {
    status: 'confirm_required',
    reason: typeof details.reason === 'string' && details.reason.trim() ? details.reason.trim() : null,
    checkedAt: typeof details.checkedAt === 'string' && details.checkedAt.trim() ? details.checkedAt.trim() : null,
  }
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
  const currentData = normalizeEsaData(root.esa009m)
  const purchaseUrlChanged = currentData[PURCHASE_URL_HEADER]?.trim()
    !== esa009m[PURCHASE_URL_HEADER]?.trim()
  if (!purchaseUrlChanged) {
    return { ...root, esa009m }
  }

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
  currentMonth?: string,
): PurchasingItemOutgoingMetrics {
  if (!metadata || typeof metadata !== 'object') return calculated
  const root = metadata as Record<string, unknown>
  const stored = root.purchasingOutgoingMetrics
  const storedValues = stored && typeof stored === 'object'
    ? stored as Record<string, unknown>
    : null
  const specialBulkOutgoingAdjustment = parseSpecialBulkOutgoingAdjustment(
    storedValues?.specialBulkOutgoingAdjustment,
  )
  const rollingBaseline = parseRollingAverageBaseline(root.purchasingRollingAverageBaseline)
  if (rollingBaseline && currentMonth) {
    if (currentMonth === rollingBaseline.referenceMonth) {
      const rollingBulkAdjustment = specialBulkOutgoingAdjustment
        ? applySpecialBulkAdjustmentToRollingBaseline(rollingBaseline, specialBulkOutgoingAdjustment)
        : null
      return {
        currentMonthOutgoing: calculated.currentMonthOutgoing,
        threeMonthAverageOutgoing: rollingBulkAdjustment?.adjustedThreeMonthAverageOutgoing
          ?? rollingBaseline.threeMonthAverageOutgoing,
        ...(rollingBulkAdjustment
          ? { specialBulkOutgoingAdjustment: rollingBulkAdjustment }
          : {}),
      }
    }
    if (currentMonth > rollingBaseline.referenceMonth) return calculated
  }

  if (!storedValues) return calculated

  const threeMonthAverageOutgoing = Number(storedValues.threeMonthAverageOutgoing)
  if (
    !Number.isFinite(threeMonthAverageOutgoing)
    || threeMonthAverageOutgoing < 0
  ) {
    return calculated
  }
  return {
    currentMonthOutgoing: calculated.currentMonthOutgoing,
    threeMonthAverageOutgoing: cleanOutgoingNumber(threeMonthAverageOutgoing),
    ...(specialBulkOutgoingAdjustment
      ? { specialBulkOutgoingAdjustment }
      : {}),
  }
}

type ParsedRollingAverageBaseline = Pick<
  PurchasingRollingAverageBaseline,
  'referenceMonth' | 'threeMonthAverageOutgoing'
> & {
  completedMonthOutgoing: Record<string, number> | null
  threeMonthSales: number | null
}

function parseRollingAverageBaseline(value: unknown): ParsedRollingAverageBaseline | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const baseline = value as Record<string, unknown>
  const referenceMonth = typeof baseline.referenceMonth === 'string'
    ? baseline.referenceMonth.trim()
    : ''
  const threeMonthAverageOutgoing = Number(baseline.threeMonthAverageOutgoing)
  if (!/^\d{4}-\d{2}$/.test(referenceMonth)
    || !Number.isFinite(threeMonthAverageOutgoing)
    || threeMonthAverageOutgoing < 0) return null
  const completedMonthOutgoing = parseCompletedMonthOutgoing(baseline.completedMonthOutgoing)
  const threeMonthSales = Number(baseline.threeMonthSales)
  return {
    referenceMonth,
    threeMonthAverageOutgoing: cleanOutgoingNumber(threeMonthAverageOutgoing),
    completedMonthOutgoing,
    threeMonthSales: Number.isFinite(threeMonthSales) && threeMonthSales >= 0
      ? cleanOutgoingNumber(threeMonthSales)
      : null,
  }
}

function parseCompletedMonthOutgoing(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const values = Object.entries(value as Record<string, unknown>)
    .flatMap(([month, quantity]) => {
      const normalizedMonth = normalizeMonthKey(month)
      const parsedQuantity = Number(quantity)
      if (!normalizedMonth || !Number.isFinite(parsedQuantity) || parsedQuantity < 0) return []
      return [[normalizedMonth, cleanOutgoingNumber(parsedQuantity)] as const]
    })
  return values.length > 0 ? Object.fromEntries(values) : null
}

function applySpecialBulkAdjustmentToRollingBaseline(
  baseline: ParsedRollingAverageBaseline,
  adjustment: PurchasingSpecialBulkOutgoingAdjustment,
): PurchasingSpecialBulkOutgoingAdjustment | null {
  if (!baseline.completedMonthOutgoing || baseline.threeMonthSales == null) return null
  const baselineMonths = Object.keys(baseline.completedMonthOutgoing).sort()
  const adjustmentMonths = adjustment.sourceMonths
    .map(normalizeMonthKey)
    .filter((month): month is string => Boolean(month))
    .sort()
  if (
    baselineMonths.length === 0
    || adjustmentMonths.length !== baselineMonths.length
    || baselineMonths.some((month, index) => month !== adjustmentMonths[index])
  ) return null

  const excludedQuantity = Math.min(
    baseline.threeMonthSales,
    Math.max(0, adjustment.specialBulkExcludedQuantity),
  )
  if (excludedQuantity <= 0) return null
  return {
    ...adjustment,
    rawThreeMonthAverageOutgoing: baseline.threeMonthAverageOutgoing,
    adjustedThreeMonthAverageOutgoing: cleanOutgoingNumber(
      (baseline.threeMonthSales - excludedQuantity) / baselineMonths.length,
    ),
  }
}

function normalizeMonthKey(value: string) {
  const trimmed = value.trim()
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})$/)
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}`
  const koreanMatch = trimmed.match(/^(\d{2}|\d{4})년\s*(\d{1,2})월$/)
  if (!koreanMatch) return null
  const year = koreanMatch[1].length === 2 ? `20${koreanMatch[1]}` : koreanMatch[1]
  return `${year}-${koreanMatch[2].padStart(2, '0')}`
}

function parseSpecialBulkOutgoingAdjustment(value: unknown): PurchasingSpecialBulkOutgoingAdjustment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const adjustment = value as Record<string, unknown>
  const specialMall = typeof adjustment.specialMall === 'string' ? adjustment.specialMall.trim() : ''
  const policy = typeof adjustment.policy === 'string' ? adjustment.policy.trim() : ''
  const sourceMonths = Array.isArray(adjustment.sourceMonths)
    ? adjustment.sourceMonths.filter((month): month is string => typeof month === 'string' && month.trim().length > 0)
    : []
  const rawThreeMonthAverageOutgoing = Number(adjustment.rawThreeMonthAverageOutgoing)
  const specialBulkQuantity = Number(adjustment.specialBulkQuantity)
  const specialBulkMonthCount = Number(adjustment.specialBulkMonthCount)
  const specialBulkIncludedQuantity = Number(adjustment.specialBulkIncludedQuantity)
  const specialBulkExcludedQuantity = Number(adjustment.specialBulkExcludedQuantity)
  const adjustedThreeMonthAverageOutgoing = Number(adjustment.adjustedThreeMonthAverageOutgoing)

  if (
    !specialMall
    || !policy
    || sourceMonths.length === 0
    || !Number.isFinite(rawThreeMonthAverageOutgoing)
    || !Number.isFinite(specialBulkQuantity)
    || !Number.isFinite(specialBulkMonthCount)
    || !Number.isFinite(specialBulkIncludedQuantity)
    || !Number.isFinite(specialBulkExcludedQuantity)
    || !Number.isFinite(adjustedThreeMonthAverageOutgoing)
  ) return null

  return {
    specialMall,
    policy,
    sourceMonths,
    rawThreeMonthAverageOutgoing: cleanOutgoingNumber(rawThreeMonthAverageOutgoing),
    specialBulkQuantity: cleanOutgoingNumber(specialBulkQuantity),
    specialBulkMonthCount: Math.max(0, Math.trunc(specialBulkMonthCount)),
    specialBulkIncludedQuantity: cleanOutgoingNumber(specialBulkIncludedQuantity),
    specialBulkExcludedQuantity: cleanOutgoingNumber(specialBulkExcludedQuantity),
    adjustedThreeMonthAverageOutgoing: cleanOutgoingNumber(adjustedThreeMonthAverageOutgoing),
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
    const searchTerms = Array.from(new Set(search
      .split(/[,，\n]+/)
      .map((term) => term.trim())
      .filter(Boolean)))
    const searchConditions = searchTerms.map((term) => {
      const pattern = `%${term}%`
      return or(
        ilike(products.internalSku, pattern),
        ilike(products.name, pattern),
        sql`${products.metadata}->'esa009m'->>'영문명' ILIKE ${pattern}`,
        sql`${products.metadata}->'esa009m'->>'HS CODE' ILIKE ${pattern}`,
        sql`${products.metadata}->'esa009m'->>${PURCHASE_URL_HEADER} ILIKE ${pattern}`,
      )!
    })
    if (searchConditions.length > 0) conditions.push(or(...searchConditions)!)
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
    const nextData = ensurePurchasingItemIdentity(
      mergeEsaData(currentData, row, headers, false),
      current,
    )
    const changedHeaders = headers.filter((header) => currentData[header] !== nextData[header])
    const identityChanged = purchasingItemIdentityChangedHeaders(currentData, nextData)
    const allChangedHeaders = [...changedHeaders, ...identityChanged]
    if (allChangedHeaders.length === 0) {
      unchangedItems += 1
      continue
    }
    changedItems += 1
    for (const header of allChangedHeaders) fieldChanges[header] = (fieldChanges[header] ?? 0) + 1
    pushSample(sampleChanges, {
      sku,
      name: row['품목명'] || current.name,
      type: 'update',
      changedHeaders: allChangedHeaders,
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

const PURCHASING_ITEM_IDENTITY_HEADERS = ['품목코드', '품목명'] as const satisfies readonly Esa009mHeader[]

export function ensurePurchasingItemIdentity(
  data: Esa009mData,
  item: { internalSku: string; name: string },
) {
  return {
    ...data,
    '품목코드': item.internalSku,
    '품목명': data['품목명']?.trim() || item.name,
  } satisfies Esa009mData
}

function purchasingItemIdentityChangedHeaders(current: Esa009mData, next: Esa009mData) {
  return PURCHASING_ITEM_IDENTITY_HEADERS.filter((header) => current[header] !== next[header])
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
