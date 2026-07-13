import ExcelJS from 'exceljs'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { actualShippingCosts, orders, shipments } from '@/lib/db/schema'
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
  relinked: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

const HEADER_CANDIDATES: Record<ActualShippingCostCarrier, {
  tracking: string[]
  fee: string[]
  orderNumber: string[]
  acceptedAt: string[]
  deliveredAt: string[]
  packageType: string[]
  quantity: string[]
  paymentType: string[]
  shipmentType: string[]
}> = {
  CJGLS: {
    tracking: ['운송장번호', '운송장 번호', '송장번호', '송장 번호'],
    fee: ['운임', '총운임', '배송비', '택배비', '운송요금'],
    orderNumber: ['주문번호', '고객주문번호', '쇼핑몰주문번호'],
    acceptedAt: ['접수일자', '접수일', '인수일자'],
    deliveredAt: ['배송일자', '배송완료일', '배달일자'],
    packageType: ['박스크기', '포장', '포장구분', '포장형태'],
    quantity: ['수량', '박스수량', '박스수'],
    paymentType: ['운임구분', '결제구분', '지불방법'],
    shipmentType: ['접수구분', '운송상품', '배송구분'],
  },
  KDEXP: {
    tracking: ['운송장번호', '운송장 번호', '송장번호', '송장 번호'],
    fee: ['운임합계', '총운임', '운임', '배송비', '택배비', '운송요금'],
    orderNumber: ['고객사주문번호', '주문번호', '쇼핑몰주문번호'],
    acceptedAt: ['발송접수일', '접수일자', '접수일'],
    deliveredAt: ['인수완료일시', '배송완료일', '배달일자'],
    packageType: ['포장상태', '박스크기', '포장'],
    quantity: ['수량', '박스수량', '박스수'],
    paymentType: ['결제구분', '운임구분', '지불방법'],
    shipmentType: ['발송구분', '운송상품', '배송구분'],
  },
  DAESIN: {
    tracking: ['운송장번호', '운송장 번호', '송장번호', '송장 번호'],
    fee: ['총운임', '운임합계', '운임', '배송비', '택배비', '운송요금'],
    orderNumber: ['품명', '주문번호', '고객사주문번호', '쇼핑몰주문번호'],
    acceptedAt: ['접수일자', '접수일', '발송접수일'],
    deliveredAt: ['배송완료일', '배달일자', '인수완료일시'],
    packageType: ['포장', '박스크기', '포장상태'],
    quantity: ['수량', '박스수량', '박스수'],
    paymentType: ['지불방법', '결제구분', '운임구분'],
    shipmentType: ['운송상품', '발송구분', '배송구분'],
  },
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
      order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
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
  await db.execute(sql`
    ALTER TABLE actual_shipping_costs
      ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE SET NULL
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS actual_shipping_costs_order_idx
      ON actual_shipping_costs(order_id)
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
  const candidates = HEADER_CANDIDATES[carrierId]
  const trackingHeader = findHeader(header, candidates.tracking)
  const feeHeader = findHeader(header, candidates.fee)

  if (!trackingHeader) {
    throw new Error(`운송장번호 열이 없습니다. 현재 인식한 열: ${Array.from(header.keys()).join(', ')}`)
  }
  if (!feeHeader) {
    throw new Error(`운임/총운임 열이 없습니다. 현재 인식한 열: ${Array.from(header.keys()).join(', ')}`)
  }

  const rows: ParsedActualShippingCostRow[] = []
  const errors: ActualShippingCostImportResult['errors'] = []

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const rawTracking = readCell(row, header, trackingHeader)
    const trackingNumber = stringify(rawTracking)
    const normalizedTrackingNumber = normalizeTrackingNumber(trackingNumber)
    if (!normalizedTrackingNumber) return

    const fee = parseMoney(readCell(row, header, feeHeader))
    if (fee == null) {
      errors.push({ row: rowNumber, reason: '실제배송비 금액을 읽지 못했습니다.' })
      return
    }

    rows.push({
      carrierId,
      trackingNumber,
      normalizedTrackingNumber,
      orderNumber: readFirstText(row, header, candidates.orderNumber),
      acceptedAt: readFirstDate(row, header, candidates.acceptedAt),
      deliveredAt: readFirstDate(row, header, candidates.deliveredAt),
      actualFee: fee,
      packageType: readFirstText(row, header, candidates.packageType),
      quantity: parseInteger(readFirstCell(row, header, candidates.quantity)) ?? 1,
      paymentType: readFirstText(row, header, candidates.paymentType),
      shipmentType: readFirstText(row, header, candidates.shipmentType),
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
  const orderByNumber = await findOrdersByNumber(
    data.userId,
    parsed.rows.map((row) => row.orderNumber),
  )

  const uniqueRows = Array.from(new Map(
    parsed.rows.map((row) => [`${row.carrierId}:${row.normalizedTrackingNumber}`, row]),
  ).values())
  let matched = 0
  const insertRows = uniqueRows.map((row) => {
    const shipment = shipmentByTracking.get(row.normalizedTrackingNumber) ?? null
    const order = shipment?.orderId
      ? { id: shipment.orderId }
      : orderByNumber.get(normalizeOrderNumber(row.orderNumber)) ?? null
    if (shipment) matched += 1
    return {
      userId: data.userId,
      carrierId: row.carrierId,
      trackingNumber: row.trackingNumber,
      normalizedTrackingNumber: row.normalizedTrackingNumber,
      shipmentId: shipment?.id ?? null,
      orderId: order?.id ?? null,
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
          orderId: sql`excluded.order_id`,
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

  const relinked = await relinkActualShippingCosts(data.userId)
  const imported = uniqueRows.length
  return {
    carrierId: data.carrierId,
    totalRows: parsed.rows.length + parsed.errors.length,
    imported,
    matched,
    unmatched: imported - matched,
    relinked,
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

export async function relinkActualShippingCosts(userId: string): Promise<number> {
  await ensureActualShippingCostsTable()
  const shipmentLinked = await db.execute<{ count: string | number }>(sql`
    WITH updated AS (
      UPDATE actual_shipping_costs a
      SET
        shipment_id = s.id,
        order_id = s.order_id,
        updated_at = now()
      FROM shipments s
      WHERE a.user_id = ${userId}
        AND a.shipment_id IS NULL
        AND s.user_id = a.user_id
        AND s.normalized_tracking_number = a.normalized_tracking_number
      RETURNING a.id
    )
    SELECT COUNT(*)::text AS count FROM updated
  `)
  const orderLinked = await db.execute<{ count: string | number }>(sql`
    WITH updated AS (
      UPDATE actual_shipping_costs a
      SET
        order_id = o.id,
        updated_at = now()
      FROM orders o
      WHERE a.user_id = ${userId}
        AND a.order_id IS NULL
        AND a.shipment_id IS NULL
        AND o.user_id = a.user_id
        AND a.order_number IN (o.marketplace_order_id, o.internal_no)
      RETURNING a.id
    )
    SELECT COUNT(*)::text AS count FROM updated
  `)

  return Number(shipmentLinked[0]?.count ?? 0) + Number(orderLinked[0]?.count ?? 0)
}

async function findShipmentsByNormalizedTracking(userId: string, normalizedValues: string[]) {
  const values = Array.from(new Set(normalizedValues.filter(Boolean)))
  const matched = new Map<string, { id: string; orderId: string }>()
  if (values.length === 0) return matched

  for (const valueChunk of chunks(values, 1000)) {
    const rows = await db
      .select({
        id: shipments.id,
        orderId: shipments.orderId,
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
      matched.set(row.normalizedTrackingNumber, { id: row.id, orderId: row.orderId })
    }
  }
  return matched
}

async function findOrdersByNumber(userId: string, rawValues: Array<string | null>) {
  const values = Array.from(new Set(rawValues.map(normalizeOrderNumber).filter(Boolean)))
  const matched = new Map<string, { id: string }>()
  if (values.length === 0) return matched

  for (const valueChunk of chunks(values, 1000)) {
    const rows = await db
      .select({
        id: orders.id,
        internalNo: orders.internalNo,
        marketplaceOrderId: orders.marketplaceOrderId,
      })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          or(
            inArray(orders.marketplaceOrderId, valueChunk),
            inArray(orders.internalNo, valueChunk),
          ),
        ),
      )

    for (const row of rows) {
      const marketplaceOrderId = normalizeOrderNumber(row.marketplaceOrderId)
      const internalNo = normalizeOrderNumber(row.internalNo)
      if (marketplaceOrderId) matched.set(marketplaceOrderId, { id: row.id })
      if (internalNo) matched.set(internalNo, { id: row.id })
    }
  }

  return matched
}

function normalizeOrderNumber(value: unknown): string {
  return String(value ?? '').trim()
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
    const key = normalizeHeader(stringify(cell.value))
    if (key) map.set(key, colNumber)
  })
  return map
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, '').trim()
}

function findHeader(header: HeaderMap, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const key = normalizeHeader(candidate)
    if (header.has(key)) return key
  }

  for (const key of header.keys()) {
    if (candidates.some((candidate) => key.includes(normalizeHeader(candidate)))) return key
  }

  return null
}

function readCell(row: ExcelJS.Row, header: HeaderMap, name: string): unknown {
  const col = header.get(normalizeHeader(name))
  return col ? row.getCell(col).value : null
}

function readFirstCell(row: ExcelJS.Row, header: HeaderMap, names: string[]): unknown {
  const name = findHeader(header, names)
  return name ? readCell(row, header, name) : null
}

function readFirstText(row: ExcelJS.Row, header: HeaderMap, names: string[]): string | null {
  const value = stringify(readFirstCell(row, header, names))
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
  const parsed = Number(text.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(value: unknown): number | null {
  const parsed = parseMoney(value)
  if (parsed == null) return null
  return Math.max(1, Math.trunc(parsed))
}

function readFirstDate(row: ExcelJS.Row, header: HeaderMap, names: string[]): string | null {
  const value = readFirstCell(row, header, names)
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
