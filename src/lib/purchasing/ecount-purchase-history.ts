import ExcelJS from 'exceljs'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  ecountPurchaseHistoryBatches,
  ecountPurchaseHistoryItems,
  products,
  productVariants,
  purchaseRequestItems,
} from '@/lib/db/schema'

const HISTORY_SHEET_NAME = '발주요청조회'
const REQUIRED_HEADERS = ['일자-No.', '품목명', '수량합계', '진행상태'] as const
export const ECOUNT_PURCHASE_HISTORY_START_DATE = '2025-08-01'

export type EcountPurchaseHistoryUpload = {
  fileName: string
  fileBuffer: ArrayBuffer
}

export type EcountPurchaseHistorySourceRow = {
  sourceRequestNumber: string
  requestDate: string | null
  managerName: string | null
  warehouseName: string | null
  sourceProductName: string
  quantity: number
  sourceNote: string | null
  sourceStatus: 'completed' | 'in_progress'
  rawData: Record<string, unknown>
}

export type EcountPurchaseHistoryImportResult = {
  files: number
  parsed: number
  saved: number
  completed: number
  inProgress: number
  exactMatched: number
  ambiguous: number
  unmatched: number
  summaryRows: number
  latestComparison: PurchaseHistoryComparison | null
}

export type PurchaseHistoryComparison = {
  comparedSkuCount: number
  sameQuantityCount: number
  increasedQuantityCount: number
  decreasedQuantityCount: number
  ecountOnlyCount: number
  recommendationOnlyCount: number
  ecountQuantity: number
  recommendationQuantity: number
}

type ProductCandidate = {
  productId: string
  internalSku: string
  productName: string
  optionName: string | null
  variantSku: string | null
}

export async function importEcountPurchaseHistory(input: {
  userId: string
  uploadedByUserId: string
  files: EcountPurchaseHistoryUpload[]
}): Promise<EcountPurchaseHistoryImportResult> {
  if (input.files.length === 0) throw new Error('업로드할 이카운트 발주요청조회 파일을 선택해주세요.')

  const candidates = await listProductCandidates(input.userId)
  const recommendationRows = await db
    .select({ sku: purchaseRequestItems.sku, requestedQuantity: purchaseRequestItems.requestedQuantity })
    .from(purchaseRequestItems)
    .where(and(
      eq(purchaseRequestItems.userId, input.userId),
      eq(purchaseRequestItems.status, 'requested'),
      sql`${purchaseRequestItems.rawData}->>'source' = 'auto_purchase_recommendation'`,
    ))
  const recommendedQuantityBySku = new Map(
    recommendationRows.map((row) => [row.sku, row.requestedQuantity]),
  )
  const parsedFiles = await Promise.all(input.files.map(async (file) => ({
    fileName: file.fileName,
    rows: (await parseEcountPurchaseHistoryExcel(file.fileBuffer))
      .filter((row) => row.requestDate === null || row.requestDate >= ECOUNT_PURCHASE_HISTORY_START_DATE),
  })))

  const result: EcountPurchaseHistoryImportResult = {
    files: parsedFiles.length,
    parsed: 0,
    saved: 0,
    completed: 0,
    inProgress: 0,
    exactMatched: 0,
    ambiguous: 0,
    unmatched: 0,
    summaryRows: 0,
    latestComparison: null,
  }

  for (const parsedFile of parsedFiles) {
    const rows = parsedFile.rows
    const dates = rows.map((row) => row.requestDate).filter((value): value is string => value !== null).sort()
    const completedRows = rows.filter((row) => row.sourceStatus === 'completed').length
    const inProgressRows = rows.filter((row) => row.sourceStatus === 'in_progress').length
    result.parsed += rows.length
    result.completed += completedRows
    result.inProgress += inProgressRows

    const matchedRows = rows.map((row) => ({ row, match: matchPurchaseHistoryRow(row, candidates) }))
    const comparison = compareEcountRowsToRecommendations(matchedRows, recommendedQuantityBySku)
    result.latestComparison = comparison

    const [batch] = await db
      .insert(ecountPurchaseHistoryBatches)
      .values({
        userId: input.userId,
        sourceFileName: parsedFile.fileName.slice(0, 255),
        sourceSheetName: HISTORY_SHEET_NAME,
        periodStart: dates[0] ?? null,
        periodEnd: dates.at(-1) ?? null,
        totalRows: rows.length,
        completedRows,
        inProgressRows,
        comparisonData: comparison,
        uploadedByUserId: input.uploadedByUserId,
      })
      .onConflictDoUpdate({
        target: [ecountPurchaseHistoryBatches.userId, ecountPurchaseHistoryBatches.sourceFileName],
        set: {
          periodStart: dates[0] ?? null,
          periodEnd: dates.at(-1) ?? null,
          totalRows: rows.length,
          completedRows,
          inProgressRows,
          comparisonData: comparison,
          uploadedByUserId: input.uploadedByUserId,
          createdAt: new Date(),
        },
      })
      .returning({ id: ecountPurchaseHistoryBatches.id })

    if (!batch || rows.length === 0) continue

    const values = matchedRows.map(({ row, match }) => {
      if (match.matchStatus === 'exact') result.exactMatched += 1
      else if (match.matchStatus === 'ambiguous') result.ambiguous += 1
      else if (match.matchStatus === 'summary') result.summaryRows += 1
      else result.unmatched += 1

      return {
        userId: input.userId,
        batchId: batch.id,
        sourceRequestNumber: row.sourceRequestNumber,
        requestDate: row.requestDate,
        managerName: row.managerName,
        warehouseName: row.warehouseName,
        sourceProductName: row.sourceProductName,
        quantity: row.quantity,
        sourceNote: row.sourceNote,
        sourceStatus: row.sourceStatus,
        matchStatus: match.matchStatus,
        productId: match.productId,
        sku: match.sku,
        candidateSkus: match.candidateSkus,
        rawData: row.rawData,
        updatedAt: new Date(),
      }
    })

    for (const chunk of chunked(values, 250)) {
      await db
        .insert(ecountPurchaseHistoryItems)
        .values(chunk)
        .onConflictDoUpdate({
          target: [ecountPurchaseHistoryItems.userId, ecountPurchaseHistoryItems.sourceRequestNumber],
          set: {
            batchId: sql`excluded.batch_id`,
            requestDate: sql`excluded.request_date`,
            managerName: sql`excluded.manager_name`,
            warehouseName: sql`excluded.warehouse_name`,
            sourceProductName: sql`excluded.source_product_name`,
            quantity: sql`excluded.quantity`,
            sourceNote: sql`excluded.source_note`,
            sourceStatus: sql`excluded.source_status`,
            matchStatus: sql`excluded.match_status`,
            productId: sql`excluded.product_id`,
            sku: sql`excluded.sku`,
            candidateSkus: sql`excluded.candidate_skus`,
            rawData: sql`excluded.raw_data`,
            updatedAt: new Date(),
          },
        })
      result.saved += chunk.length
    }
  }

  return result
}

export async function getEcountPurchaseHistorySummary(userId: string) {
  const [[summary], [latestBatch]] = await Promise.all([
    db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${ecountPurchaseHistoryItems.sourceStatus} = 'completed')::int`,
      inProgress: sql<number>`count(*) filter (where ${ecountPurchaseHistoryItems.sourceStatus} = 'in_progress')::int`,
      exactMatched: sql<number>`count(*) filter (where ${ecountPurchaseHistoryItems.matchStatus} = 'exact')::int`,
      reviewRequired: sql<number>`count(*) filter (where ${ecountPurchaseHistoryItems.matchStatus} in ('ambiguous', 'unmatched', 'summary'))::int`,
      firstDate: sql<string | null>`min(${ecountPurchaseHistoryItems.requestDate})`,
      lastDate: sql<string | null>`max(${ecountPurchaseHistoryItems.requestDate})`,
    })
    .from(ecountPurchaseHistoryItems)
      .where(eq(ecountPurchaseHistoryItems.userId, userId)),
    db
      .select({ comparisonData: ecountPurchaseHistoryBatches.comparisonData, sourceFileName: ecountPurchaseHistoryBatches.sourceFileName })
      .from(ecountPurchaseHistoryBatches)
      .where(eq(ecountPurchaseHistoryBatches.userId, userId))
      .orderBy(desc(ecountPurchaseHistoryBatches.createdAt))
      .limit(1),
  ])

  return {
    ...(summary ?? {
      total: 0,
      completed: 0,
      inProgress: 0,
      exactMatched: 0,
      reviewRequired: 0,
      firstDate: null,
      lastDate: null,
    }),
    latestComparison: latestBatch?.comparisonData ?? null,
    latestComparisonFileName: latestBatch?.sourceFileName ?? null,
  }
}

function compareEcountRowsToRecommendations(
  rows: Array<{ row: EcountPurchaseHistorySourceRow; match: ReturnType<typeof matchPurchaseHistoryRow> }>,
  recommendedQuantityBySku: Map<string, number>,
): PurchaseHistoryComparison {
  const ecountQuantityBySku = new Map<string, number>()
  for (const { row, match } of rows) {
    if (match.matchStatus !== 'exact' || !match.sku) continue
    ecountQuantityBySku.set(match.sku, (ecountQuantityBySku.get(match.sku) ?? 0) + row.quantity)
  }

  let sameQuantityCount = 0
  let increasedQuantityCount = 0
  let decreasedQuantityCount = 0
  let ecountOnlyCount = 0
  let recommendationOnlyCount = 0
  for (const [sku, ecountQuantity] of ecountQuantityBySku) {
    const recommendedQuantity = recommendedQuantityBySku.get(sku)
    if (recommendedQuantity == null) {
      ecountOnlyCount += 1
    } else if (ecountQuantity === recommendedQuantity) {
      sameQuantityCount += 1
    } else if (ecountQuantity > recommendedQuantity) {
      increasedQuantityCount += 1
    } else {
      decreasedQuantityCount += 1
    }
  }
  for (const sku of recommendedQuantityBySku.keys()) {
    if (!ecountQuantityBySku.has(sku)) recommendationOnlyCount += 1
  }

  return {
    comparedSkuCount: sameQuantityCount + increasedQuantityCount + decreasedQuantityCount,
    sameQuantityCount,
    increasedQuantityCount,
    decreasedQuantityCount,
    ecountOnlyCount,
    recommendationOnlyCount,
    ecountQuantity: Array.from(ecountQuantityBySku.values()).reduce((total, quantity) => total + quantity, 0),
    recommendationQuantity: Array.from(recommendedQuantityBySku.values()).reduce((total, quantity) => total + quantity, 0),
  }
}

export async function parseEcountPurchaseHistoryExcel(fileBuffer: ArrayBuffer): Promise<EcountPurchaseHistorySourceRow[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(fileBuffer) as unknown as ExcelJS.Buffer)
  const sheet = workbook.getWorksheet(HISTORY_SHEET_NAME) ?? workbook.worksheets[0]
  if (!sheet) throw new Error('엑셀 시트를 찾지 못했습니다.')

  const header = findHeader(sheet)
  if (!header) {
    throw new Error(`이카운트 발주요청조회 양식이 아닙니다. 필요한 열: ${REQUIRED_HEADERS.join(', ')}`)
  }

  const rows: EcountPurchaseHistorySourceRow[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= header.rowNumber) return
    const requestNumber = textAt(row, header.columns.get('일자-No.'))
    const sourceProductName = textAt(row, header.columns.get('품목명'))
    const sourceStatus = normalizeSourceStatus(textAt(row, header.columns.get('진행상태')))
    if (!requestNumber || !sourceProductName || !sourceStatus) return

    rows.push({
      sourceRequestNumber: requestNumber,
      requestDate: parseRequestDate(requestNumber),
      managerName: nullIfEmpty(textAt(row, header.columns.get('담당자명'))),
      warehouseName: nullIfEmpty(textAt(row, header.columns.get('창고명'))),
      sourceProductName,
      quantity: parseQuantity(textAt(row, header.columns.get('수량합계'))),
      sourceNote: nullIfEmpty(textAt(row, header.columns.get('특이사항'))),
      sourceStatus,
      rawData: { sourceRowNumber: rowNumber, sourceStatusText: textAt(row, header.columns.get('진행상태')) },
    })
  })
  return rows
}

export function matchPurchaseHistoryRow(row: EcountPurchaseHistorySourceRow, candidates: ProductCandidate[]) {
  if (/외\s*\d+건/.test(row.sourceProductName)) {
    return { matchStatus: 'summary' as const, productId: null, sku: null, candidateSkus: [] }
  }

  const normalizedSource = normalizeProductName(row.sourceProductName)
  const matchedProducts = new Map<string, ProductCandidate>()
  for (const candidate of candidates) {
    const productName = normalizeProductName(candidate.productName)
    const combinedName = normalizeProductName(`${candidate.productName} ${candidate.optionName ?? ''}`)
    if (normalizedSource === productName || normalizedSource === combinedName) {
      matchedProducts.set(candidate.productId, candidate)
    }
  }
  const matches = Array.from(matchedProducts.values())
  const candidateSkus = matches.map((candidate) => candidate.variantSku ?? candidate.internalSku)
  if (matches.length === 1) {
    const [match] = matches
    return {
      matchStatus: 'exact' as const,
      productId: match.productId,
      sku: match.variantSku ?? match.internalSku,
      candidateSkus,
    }
  }
  return {
    matchStatus: matches.length > 1 ? 'ambiguous' as const : 'unmatched' as const,
    productId: null,
    sku: null,
    candidateSkus,
  }
}

async function listProductCandidates(userId: string): Promise<ProductCandidate[]> {
  const rows = await db
    .select({
      productId: products.id,
      internalSku: products.internalSku,
      productName: products.name,
      optionName: productVariants.optionName,
      variantSku: productVariants.sku,
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .where(eq(products.userId, userId))
    .orderBy(asc(products.internalSku))

  return rows.map((row) => ({
    ...row,
    optionName: row.optionName ?? null,
    variantSku: row.variantSku ?? null,
  }))
}

function findHeader(sheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const columns = new Map<string, number>()
    row.eachCell((cell, columnNumber) => {
      const value = cellText(cell.value).trim()
      if (value) columns.set(value, columnNumber)
    })
    if (REQUIRED_HEADERS.every((header) => columns.has(header))) return { rowNumber, columns }
  }
  return null
}

function textAt(row: ExcelJS.Row, column: number | undefined) {
  return column ? cellText(row.getCell(column).value).trim() : ''
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && 'text' in value) return String(value.text ?? '')
  if (typeof value === 'object' && 'result' in value) return cellText(value.result as ExcelJS.CellValue)
  return String(value)
}

function normalizeSourceStatus(value: string): 'completed' | 'in_progress' | null {
  if (value.includes('완료')) return 'completed'
  if (value.includes('진행')) return 'in_progress'
  return null
}

function parseRequestDate(value: string) {
  const match = value.match(/^(20\d{2})(\d{2})(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

function parseQuantity(value: string) {
  const quantity = Number(value.replaceAll(',', ''))
  return Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0
}

function normalizeProductName(value: string) {
  return value
    .replace(/\s*외\s*\d+건\s*$/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^0-9A-Za-z가-힣]/g, '')
    .toLocaleLowerCase('ko-KR')
}

function nullIfEmpty(value: string) {
  return value || null
}

function* chunked<T>(items: T[], size: number) {
  for (let index = 0; index < items.length; index += size) yield items.slice(index, index + size)
}
