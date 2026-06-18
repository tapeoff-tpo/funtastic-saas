import ExcelJS from 'exceljs'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { actualShippingCosts, shipments } from '@/lib/db/schema'
import type { ActualShippingCostCarrier } from './actual-cost-types'

type HeaderMap = Map<string, number>

export interface ParsedActualShippingCostRow {
  carrierId: ActualShippingCostCarrier
  trackingNumber: string
  normalizedTrackingNumber: string
  orderNumber: string | null
  acceptedAt: string | null
  deliveredAt: string | null
  actualFee: number
  packageType: string | null
  quantity: number
  paymentType: string | null
  shipmentType: string | null
  rowNumber: number
  rawData: Record<string, unknown>
}

export interface ActualShippingCostImportResult {
  carrierId: ActualShippingCostCarrier
  totalRows: number
  imported: number
  matched: number
  unmatched: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

const CARRIER_REQUIRED_HEADERS: Record<ActualShippingCostCarrier, string[]> = {
  CJGLS: ['운송장번호', '운임'],
  KDEXP: ['운송장번호', '운임합계'],
  DAESIN: ['운송장번호', '총운임'],
}

export async function ensureActualShippingCostsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS actual_shipping_costs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      carrier_id varchar(50) NOT NULL,
      tracking_number varchar(100) NOT NULL,
      normalized_tracking_number varchar(100) NOT NULL,
      shipment_id uuid REFERENCES shipments(id) ON DELETE SET NULL,
      order_number varchar(200),
      accepted_at date,
      delivered_at date,
      actual_fee numeric(12, 2) NOT NULL,
      package_type varchar(100),
      quantity integer NOT NULL DEFAULT 1,
      payment_type varchar(100),
      shipment_type varchar(100),
      source_file_name varchar(255),
      row_number integer NOT NULL,
      raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      imported_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS actual_shipping_costs_user_carrier_tracking_unique
      ON actual_shipping_costs(user_id, carrier_id, normalized_tracking_number)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS actual_shipping_costs_user_imported_idx
      ON actual_shipping_costs(user_id, imported_at)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS actual_shipping_costs_shipment_idx
      ON actual_shipping_costs(shipment_id)
  `)
}

export function normalizeTrackingNumber(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase()
}

export async function parseActualShippingCostWorkbook(
  carrierId: ActualShippingCostCarrier,
  fileBuffer: ArrayBuffer,
): Promise<{ rows: ParsedActualShippingCostRow[]; errors: ActualShippingCostImportResult['errors'] }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(fileBuffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('엑셀 시트를 찾을 수 없습니다.')

  const header = readHeader(ws)
  for (const required of CARRIER_REQUIRED_HEADERS[carrierId]) {
    if (!header.has(required)) {
      throw new Error(`${required} 열이 없습니다. 택배사 양식이 맞는지 확인해주세요.`)
    }
  }

  const rows: ParsedActualShippingCostRow[] = []
  const errors: ActualShippingCostImportResult['errors'] = []

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const rawTracking = readCell(row, header, '운송장번호')
    const trackingNumber = stringify(rawTracking)
    const normalizedTrackingNumber = normalizeTrackingNumber(trackingNumber)
    if (!normalizedTrackingNumber) return

    const fee = parseMoney(readFee(row, header, carrierId))
    if (fee == null) {
      errors.push({ row: rowNumber, reason: '실제배송비 금액을 읽지 못했습니다.' })
      return
    }

    rows.push({
      carrierId,
      trackingNumber,
      normalizedTrackingNumber,
      orderNumber: readOrderNumber(row, header, carrierId),
      acceptedAt: readDate(row, header, acceptedDateHeader(carrierId)),
      deliveredAt: readDate(row, header, deliveredDateHeader(carrierId)),
      actualFee: fee,
      packageType: readText(row, header, packageHeader(carrierId)),
      quantity: parseInteger(readCell(row, header, quantityHeader())) ?? 1,
      paymentType: readText(row, header, paymentHeader(carrierId)),
      shipmentType: readText(row, header, shipmentTypeHeader(carrierId)),
      rowNumber,
      rawData: readRawData(row, header),
    })
  })

  return { rows, errors }
}

export async function importActualShippingCosts(data: {
  userId: string
  carrierId: ActualShippingCostCarrier
  fileBuffer: ArrayBuffer
  sourceFileName?: string
}): Promise<ActualShippingCostImportResult> {
  await ensureActualShippingCostsTable()
  const parsed = await parseActualShippingCostWorkbook(data.carrierId, data.fileBuffer)
  const shipmentByTracking = await findShipmentsByNormalizedTracking(
    data.userId,
    parsed.rows.map((row) => row.normalizedTrackingNumber),
  )

  const uniqueRows = Array.from(new Map(
    parsed.rows.map((row) => [`${row.carrierId}:${row.normalizedTrackingNumber}`, row]),
  ).values())
  let matched = 0
  const insertRows = uniqueRows.map((row) => {
    const shipment = shipmentByTracking.get(row.normalizedTrackingNumber) ?? null
    if (shipment) matched += 1
    return {
      userId: data.userId,
      carrierId: row.carrierId,
      trackingNumber: row.trackingNumber,
      normalizedTrackingNumber: row.normalizedTrackingNumber,
      shipmentId: shipment?.id ?? null,
      orderNumber: row.orderNumber,
      acceptedAt: row.acceptedAt,
      deliveredAt: row.deliveredAt,
      actualFee: String(row.actualFee),
      packageType: row.packageType,
      quantity: row.quantity,
      paymentType: row.paymentType,
      shipmentType: row.shipmentType,
      sourceFileName: data.sourceFileName,
      rowNumber: row.rowNumber,
      rawData: row.rawData,
      updatedAt: new Date(),
    }
  })

  for (const rows of chunks(insertRows, 250)) {
    await db
      .insert(actualShippingCosts)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          actualShippingCosts.userId,
          actualShippingCosts.carrierId,
          actualShippingCosts.normalizedTrackingNumber,
        ],
        set: {
          trackingNumber: sql`excluded.tracking_number`,
          shipmentId: sql`excluded.shipment_id`,
          orderNumber: sql`excluded.order_number`,
          acceptedAt: sql`excluded.accepted_at`,
          deliveredAt: sql`excluded.delivered_at`,
          actualFee: sql`excluded.actual_fee`,
          packageType: sql`excluded.package_type`,
          quantity: sql`excluded.quantity`,
          paymentType: sql`excluded.payment_type`,
          shipmentType: sql`excluded.shipment_type`,
          sourceFileName: sql`excluded.source_file_name`,
          rowNumber: sql`excluded.row_number`,
          rawData: sql`excluded.raw_data`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
  }

  const imported = uniqueRows.length
  return {
    carrierId: data.carrierId,
    totalRows: parsed.rows.length + parsed.errors.length,
    imported,
    matched,
    unmatched: imported - matched,
    skipped: parsed.errors.length,
    errors: parsed.errors,
  }
}

export async function getActualShippingCostRecentImports(userId: string) {
  await ensureActualShippingCostsTable()
  return db
    .select({
      id: actualShippingCosts.id,
      carrierId: actualShippingCosts.carrierId,
      trackingNumber: actualShippingCosts.trackingNumber,
      actualFee: actualShippingCosts.actualFee,
      shipmentId: actualShippingCosts.shipmentId,
      sourceFileName: actualShippingCosts.sourceFileName,
      importedAt: actualShippingCosts.importedAt,
    })
    .from(actualShippingCosts)
    .where(eq(actualShippingCosts.userId, userId))
    .orderBy(desc(actualShippingCosts.importedAt))
    .limit(20)
}

async function findShipmentsByNormalizedTracking(userId: string, normalizedValues: string[]) {
  const values = Array.from(new Set(normalizedValues.filter(Boolean)))
  const matched = new Map<string, { id: string }>()
  if (values.length === 0) return matched

  for (const valueChunk of chunks(values, 1000)) {
    const rows = await db
      .select({
        id: shipments.id,
        normalizedTrackingNumber: shipments.normalizedTrackingNumber,
      })
      .from(shipments)
      .where(
        and(
          eq(shipments.userId, userId),
          inArray(shipments.normalizedTrackingNumber, valueChunk),
        ),
      )

    for (const row of rows) {
      matched.set(row.normalizedTrackingNumber, { id: row.id })
    }
  }
  return matched
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function readHeader(ws: ExcelJS.Worksheet): HeaderMap {
  const map: HeaderMap = new Map()
  const row = ws.getRow(1)
  row.eachCell((cell, colNumber) => {
    const key = stringify(cell.value)
    if (key) map.set(key, colNumber)
  })
  return map
}

function readCell(row: ExcelJS.Row, header: HeaderMap, name: string): unknown {
  const col = header.get(name)
  return col ? row.getCell(col).value : null
}

function readText(row: ExcelJS.Row, header: HeaderMap, name: string | null): string | null {
  if (!name) return null
  const value = stringify(readCell(row, header, name))
  return value || null
}

function stringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value) return stringify(value.result)
    if (value instanceof Date) return value.toISOString().slice(0, 10)
  }
  return String(value).trim()
}

function parseMoney(value: unknown): number | null {
  const text = stringify(value).replace(/,/g, '')
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(value: unknown): number | null {
  const parsed = parseMoney(value)
  if (parsed == null) return null
  return Math.max(1, Math.trunc(parsed))
}

function readDate(row: ExcelJS.Row, header: HeaderMap, name: string | null): string | null {
  if (!name) return null
  const value = readCell(row, header, name)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = stringify(value)
  if (!text) return null
  const match = text.match(/\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function readRawData(row: ExcelJS.Row, header: HeaderMap): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  for (const [name, col] of header) {
    raw[name] = stringify(row.getCell(col).value)
  }
  return raw
}

function readFee(row: ExcelJS.Row, header: HeaderMap, carrierId: ActualShippingCostCarrier): unknown {
  if (carrierId === 'CJGLS') return readCell(row, header, '운임')
  if (carrierId === 'KDEXP') return readCell(row, header, '운임합계')
  return readCell(row, header, '총운임')
}

function readOrderNumber(row: ExcelJS.Row, header: HeaderMap, carrierId: ActualShippingCostCarrier): string | null {
  const name = carrierId === 'KDEXP' ? '고객사주문번호' : carrierId === 'DAESIN' ? '품명' : '주문번호'
  return readText(row, header, name)
}

function acceptedDateHeader(carrierId: ActualShippingCostCarrier): string {
  if (carrierId === 'CJGLS') return '접수일자'
  if (carrierId === 'KDEXP') return '발송접수일'
  return '접수일자'
}

function deliveredDateHeader(carrierId: ActualShippingCostCarrier): string | null {
  if (carrierId === 'CJGLS') return '배송일자'
  if (carrierId === 'KDEXP') return '인수완료일시'
  return null
}

function packageHeader(carrierId: ActualShippingCostCarrier): string {
  if (carrierId === 'CJGLS') return '박스타입'
  if (carrierId === 'KDEXP') return '포장상태'
  return '포장'
}

function quantityHeader(): string {
  return '수량'
}

function paymentHeader(carrierId: ActualShippingCostCarrier): string {
  if (carrierId === 'CJGLS') return '운임구분'
  if (carrierId === 'KDEXP') return '결제구분'
  return '지불방법'
}

function shipmentTypeHeader(carrierId: ActualShippingCostCarrier): string {
  if (carrierId === 'CJGLS') return '접수구분'
  if (carrierId === 'KDEXP') return '발송구분'
  return '운송상품'
}
