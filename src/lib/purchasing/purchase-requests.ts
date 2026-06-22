import ExcelJS from 'exceljs'
import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  chinaWarehouseInventory,
  chinaWarehouseInventoryMovements,
  purchaseRequestBatches,
  purchaseRequestItems,
} from '@/lib/db/schema'
import type { PurchaseRequestStatus } from './purchase-request-status'

const PURCHASE_HEADERS = [
  '일자',
  '순번',
  '담당자',
  '입고창고',
  '거래유형',
  '통화',
  '환율',
  '납기일자',
  '요청자',
  '추가예산 배정',
  '적요',
  '품목코드',
  '품목명',
  '규격',
  '구매수량(EA)',
  '중국창고 도착요청일',
  'x패키지 수량(SET)',
  '실 구매 수량(C)',
  '구입관리코드',
  '적요',
  '사전포장여부',
  '바코드 한글명',
  '바코드 NO',
  '비고 (현재고/월 판매/3개월불량)',
  '구매단가',
  '총 구매가(위안화)',
  '총 구매가(원화)',
  '운송비',
  '생산공정',
  '구매 참고사항',
  '패키지 제작여부 코드',
  '패키지 제작여부',
  '한글설명서 제작여부 코드',
  '한글설명서 제작여부',
  '현재상태',
  '제조사 제품개선 피드백 날짜',
  '예상 도착일자 (당일+조달기간+7일)',
  '품목구분',
  '',
  '담당자이름',
  '담당자코드',
] as const

type PurchaseRow = Record<string, string | null>

export async function importPurchaseRequestWorkbook(input: {
  userId: string
  uploadedByUserId: string
  fileName: string
  fileBuffer: ArrayBuffer
}) {
  const parsed = await parsePurchaseRequestWorkbook(input.fileBuffer)

  const [batch] = await db
    .insert(purchaseRequestBatches)
    .values({
      userId: input.userId,
      sourceFileName: input.fileName,
      sourceSheetName: parsed.sheetName,
      totalRows: parsed.total,
      importedRows: parsed.rows.length,
      skippedRows: parsed.skipped,
      uploadedByUserId: input.uploadedByUserId,
    })
    .returning({ id: purchaseRequestBatches.id })

  if (parsed.rows.length > 0) {
    for (const chunk of chunks(parsed.rows, 250)) {
      await db.insert(purchaseRequestItems).values(chunk.map(({ rowNumber, data }) => ({
        userId: input.userId,
        batchId: batch.id,
        rowNumber,
        requestDate: excelDate(data['일자']),
        sequence: integerText(data['순번']),
        managerCode: data['담당자'],
        inboundWarehouseCode: data['입고창고'],
        tradeType: data['거래유형'],
        currency: data['통화'],
        exchangeRate: numericText(data['환율']),
        dueDate: excelDate(data['납기일자']),
        requester: data['요청자'],
        extraBudgetYn: data['추가예산 배정'],
        memo: data['적요'],
        sku: data['품목코드']!,
        productName: data['품목명']!,
        optionName: data['규격'],
        requestedQuantity: integerText(data['구매수량(EA)']) ?? 0,
        chinaArrivalRequestDate: excelDate(data['중국창고 도착요청일']),
        packageSetQuantity: integerText(data['x패키지 수량(SET)']),
        actualPurchaseQuantity: integerText(data['실 구매 수량(C)']),
        purchaseManagementCode: data['구입관리코드'],
        purchaseMemo: data['적요__2'],
        prepackRequired: data['사전포장여부'],
        barcodeName: data['바코드 한글명'],
        barcodeNo: data['바코드 NO'],
        stockMemo: data['비고 (현재고/월 판매/3개월불량)'],
        unitPriceCny: numericText(data['구매단가']),
        totalPriceCny: numericText(data['총 구매가(위안화)']),
        totalPriceKrw: numericText(data['총 구매가(원화)']),
        shippingFeeCny: numericText(data['운송비']),
        productionProcess: data['생산공정'],
        purchaseNote: data['구매 참고사항'],
        packageRequiredCode: data['패키지 제작여부 코드'],
        packageRequired: data['패키지 제작여부'],
        koreanManualRequiredCode: data['한글설명서 제작여부 코드'],
        koreanManualRequired: data['한글설명서 제작여부'],
        sourceCurrentState: data['현재상태'],
        improvementFeedbackDate: excelDate(data['제조사 제품개선 피드백 날짜']),
        expectedArrivalDate: excelDate(data['예상 도착일자 (당일+조달기간+7일)']),
        productType: data['품목구분'],
        buyerName: data['담당자이름'],
        buyerCode: data['담당자코드'],
        rawData: data,
      }))).onConflictDoNothing()
    }
  }

  return {
    batchId: batch.id,
    total: parsed.total,
    imported: parsed.rows.length,
    skipped: parsed.skipped,
  }
}

export async function parsePurchaseRequestWorkbook(fileBuffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)
  const sheet = workbook.getWorksheet('발주등록') ?? workbook.worksheets[0]
  if (!sheet) throw new Error('엑셀 시트를 찾을 수 없습니다.')

  const headerRowNumber = findPurchaseHeaderRow(sheet)
  if (!headerRowNumber) throw new Error('발주등록 시트의 헤더를 찾을 수 없습니다.')

  const rows: Array<{ rowNumber: number; data: PurchaseRow }> = []
  let total = 0
  let skipped = 0

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return
    const data = readPurchaseRow(row)
    if (!Object.values(data).some(Boolean)) return
    total += 1
    if (!data['품목코드'] || !data['품목명']) {
      skipped += 1
      return
    }
    rows.push({ rowNumber, data })
  })

  return { sheetName: sheet.name, rows, total, skipped }
}

export async function getPurchaseRequests(input: {
  userId: string
  status?: PurchaseRequestStatus
  search?: string
  page?: number
  pageSize?: number
}) {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 50
  const conditions: SQL[] = [eq(purchaseRequestItems.userId, input.userId)]

  if (input.status) conditions.push(eq(purchaseRequestItems.status, input.status))
  if (input.search) {
    const pattern = `%${input.search}%`
    conditions.push(or(
      ilike(purchaseRequestItems.sku, pattern),
      ilike(purchaseRequestItems.productName, pattern),
      ilike(purchaseRequestItems.optionName, pattern),
      ilike(purchaseRequestItems.purchaseManagementCode, pattern),
      ilike(purchaseRequestItems.supplierOrderNumber, pattern),
    )!)
  }

  const where = and(...conditions)
  const [items, [{ total }], statusCounts] = await Promise.all([
    db
      .select()
      .from(purchaseRequestItems)
      .where(where)
      .orderBy(desc(purchaseRequestItems.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(purchaseRequestItems).where(where),
    db
      .select({
        status: purchaseRequestItems.status,
        total: count(),
      })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.userId, input.userId))
      .groupBy(purchaseRequestItems.status),
  ])

  return {
    items,
    total,
    statusCounts: Object.fromEntries(statusCounts.map((row) => [row.status, row.total])) as Partial<Record<PurchaseRequestStatus, number>>,
  }
}

export async function updatePurchaseRequestStatus(input: {
  userId: string
  id: string
  status: PurchaseRequestStatus
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!current) return null
    if (current.status === input.status) return { id: current.id }

    if (input.status === 'china_arrived') {
      await addChinaWarehouseStock(tx, current)
    }
    if (input.status === 'outbound_requested') {
      await subtractChinaWarehouseStock(tx, current)
    }

    const values: Partial<typeof purchaseRequestItems.$inferInsert> = {
      status: input.status,
      updatedAt: new Date(),
    }
    if (input.status === 'china_arrived') {
      values.chinaReceivedAt = current.chinaReceivedAt ?? new Date()
      values.chinaReceivedQuantity = current.chinaReceivedQuantity ?? purchaseQuantity(current)
    }

    const [row] = await tx
      .update(purchaseRequestItems)
      .set(values)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .returning({ id: purchaseRequestItems.id })

    return row ?? null
  })
}

export async function updatePurchaseRequestPlanFields(input: {
  userId: string
  id: string
  supplierOrderNumber?: string | null
  outboundExpectedDate?: string | null
  purchaseMethod?: string | null
  purchaseConfirmed?: boolean
}) {
  const [row] = await db
    .update(purchaseRequestItems)
    .set({
      supplierOrderNumber: emptyToNull(input.supplierOrderNumber),
      outboundExpectedDate: input.outboundExpectedDate || null,
      purchaseMethod: emptyToNull(input.purchaseMethod),
      purchaseConfirmed: input.purchaseConfirmed ?? false,
      updatedAt: new Date(),
    })
    .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
    .returning({ id: purchaseRequestItems.id })

  return row ?? null
}

export async function deletePurchaseRequestItem(input: {
  userId: string
  id: string
}) {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!item) return null

    const movements = await tx
      .select()
      .from(chinaWarehouseInventoryMovements)
      .where(and(
        eq(chinaWarehouseInventoryMovements.userId, input.userId),
        eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, input.id),
      ))

    for (const movement of movements) {
      await tx
        .update(chinaWarehouseInventory)
        .set({
          totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} - ${movement.delta}`,
          availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} - ${movement.delta}`,
          updatedAt: new Date(),
        })
        .where(eq(chinaWarehouseInventory.id, movement.inventoryId))
    }

    await tx
      .delete(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))

    await tx
      .delete(chinaWarehouseInventory)
      .where(and(
        eq(chinaWarehouseInventory.userId, input.userId),
        eq(chinaWarehouseInventory.totalQuantity, 0),
        eq(chinaWarehouseInventory.availableQuantity, 0),
      ))

    return { id: input.id }
  })
}

export async function getChinaWarehouseInventory(input: {
  userId: string
  search?: string
  page?: number
  pageSize?: number
}) {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 50
  const conditions: SQL[] = [
    eq(chinaWarehouseInventory.userId, input.userId),
    sql`${chinaWarehouseInventory.totalQuantity} > 0`,
  ]
  if (input.search) {
    const pattern = `%${input.search}%`
    conditions.push(or(
      ilike(chinaWarehouseInventory.sku, pattern),
      ilike(chinaWarehouseInventory.productName, pattern),
      ilike(chinaWarehouseInventory.optionName, pattern),
    )!)
  }

  const where = and(...conditions)
  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(chinaWarehouseInventory)
      .where(where)
      .orderBy(asc(chinaWarehouseInventory.sku), asc(chinaWarehouseInventory.optionKey))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(chinaWarehouseInventory).where(where),
  ])

  return { items, total }
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type PurchaseRequestItem = typeof purchaseRequestItems.$inferSelect

async function addChinaWarehouseStock(tx: DbTransaction, item: PurchaseRequestItem) {
  const quantity = purchaseQuantity(item)
  if (quantity <= 0) return
  const optionKey = item.optionName ?? ''

  const [existingMovement] = await tx
    .select({ id: chinaWarehouseInventoryMovements.id })
    .from(chinaWarehouseInventoryMovements)
    .where(and(
      eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, item.id),
      eq(chinaWarehouseInventoryMovements.movementType, 'arrival'),
    ))
    .limit(1)
  if (existingMovement) return

  await tx
    .insert(chinaWarehouseInventory)
    .values({
      userId: item.userId,
      sku: item.sku,
      productName: item.productName,
      optionKey,
      optionName: item.optionName,
      totalQuantity: quantity,
      availableQuantity: quantity,
      lastArrivedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        chinaWarehouseInventory.userId,
        chinaWarehouseInventory.sku,
        chinaWarehouseInventory.optionKey,
      ],
      set: {
        productName: item.productName,
        optionName: item.optionName,
        totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} + ${quantity}`,
        availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} + ${quantity}`,
        lastArrivedAt: new Date(),
        updatedAt: new Date(),
      },
    })

  const [inventoryRow] = await tx
    .select()
    .from(chinaWarehouseInventory)
    .where(and(
      eq(chinaWarehouseInventory.userId, item.userId),
      eq(chinaWarehouseInventory.sku, item.sku),
      eq(chinaWarehouseInventory.optionKey, optionKey),
    ))
    .limit(1)

  if (!inventoryRow) throw new Error('중국창고 재고 반영에 실패했습니다.')

  await tx.insert(chinaWarehouseInventoryMovements).values({
    inventoryId: inventoryRow.id,
    userId: item.userId,
    purchaseRequestItemId: item.id,
    movementType: 'arrival',
    delta: quantity,
    quantityBefore: inventoryRow.totalQuantity - quantity,
    quantityAfter: inventoryRow.totalQuantity,
    note: '중국창고도착 상태 이동',
  }).onConflictDoNothing()
}

async function subtractChinaWarehouseStock(tx: DbTransaction, item: PurchaseRequestItem) {
  const quantity = purchaseQuantity(item)
  if (quantity <= 0) return
  const optionKey = item.optionName ?? ''

  const [existingMovement] = await tx
    .select({ id: chinaWarehouseInventoryMovements.id })
    .from(chinaWarehouseInventoryMovements)
    .where(and(
      eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, item.id),
      eq(chinaWarehouseInventoryMovements.movementType, 'outbound_request'),
    ))
    .limit(1)
  if (existingMovement) return

  const [inventoryRow] = await tx
    .select()
    .from(chinaWarehouseInventory)
    .where(and(
      eq(chinaWarehouseInventory.userId, item.userId),
      eq(chinaWarehouseInventory.sku, item.sku),
      eq(chinaWarehouseInventory.optionKey, optionKey),
    ))
    .limit(1)

  if (!inventoryRow) throw new Error('중국창고 재고가 없는 상품은 출고요청으로 이동할 수 없습니다.')
  if (inventoryRow.availableQuantity < quantity) {
    throw new Error(`중국창고 재고가 부족합니다. 현재 ${inventoryRow.availableQuantity}개, 요청 ${quantity}개`)
  }

  await tx
    .update(chinaWarehouseInventory)
    .set({
      totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} - ${quantity}`,
      availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} - ${quantity}`,
      lastOutboundRequestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(chinaWarehouseInventory.id, inventoryRow.id))

  await tx.insert(chinaWarehouseInventoryMovements).values({
    inventoryId: inventoryRow.id,
    userId: item.userId,
    purchaseRequestItemId: item.id,
    movementType: 'outbound_request',
    delta: -quantity,
    quantityBefore: inventoryRow.totalQuantity,
    quantityAfter: inventoryRow.totalQuantity - quantity,
    note: '출고요청 상태 이동',
  }).onConflictDoNothing()

  await deleteEmptyChinaWarehouseInventory(tx, item.userId)
}

async function deleteEmptyChinaWarehouseInventory(tx: DbTransaction, userId: string) {
  await tx
    .delete(chinaWarehouseInventory)
    .where(and(
      eq(chinaWarehouseInventory.userId, userId),
      eq(chinaWarehouseInventory.totalQuantity, 0),
      eq(chinaWarehouseInventory.availableQuantity, 0),
    ))
}

function purchaseQuantity(item: PurchaseRequestItem) {
  return item.chinaReceivedQuantity ?? item.actualPurchaseQuantity ?? item.requestedQuantity ?? 0
}

function findPurchaseHeaderRow(sheet: ExcelJS.Worksheet): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const values = new Set<string>()
    row.eachCell((cell) => values.add(normalizeHeader(cellText(cell.value))))
    if (values.has('품목코드') && values.has('구매수량(EA)')) return rowNumber
  }
  return null
}

function readPurchaseRow(row: ExcelJS.Row): PurchaseRow {
  const seen = new Map<string, number>()
  const result: PurchaseRow = {}

  PURCHASE_HEADERS.forEach((header, index) => {
    if (!header) return
    const count = seen.get(header) ?? 0
    seen.set(header, count + 1)
    const key = count === 0 ? header : `${header}__${count + 1}`
    result[key] = cellText(row.getCell(index + 1).value) || null
  })

  return result
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim()
    if ('formula' in value) return ''
  }
  return String(value).trim()
}

function excelDate(value: string | null): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  const epoch = new Date(Date.UTC(1899, 11, 30))
  epoch.setUTCDate(epoch.getUTCDate() + Math.floor(number))
  return epoch.toISOString().slice(0, 10)
}

function integerText(value: string | null): number | null {
  if (!value) return null
  const number = Number(value.replace(/,/g, ''))
  return Number.isFinite(number) ? Math.trunc(number) : null
}

function numericText(value: string | null): string | null {
  if (!value) return null
  const number = Number(value.replace(/,/g, ''))
  return Number.isFinite(number) ? String(number) : null
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
