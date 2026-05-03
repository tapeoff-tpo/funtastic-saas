/**
 * POST /api/inventory/incoming/parse
 *
 * Accepts multipart FormData with `file` (xlsx).
 * Looks for "제품단위" sheet (or first sheet as fallback).
 * Row 1 is skipped (title), Row 2 is headers, Row 3+ is data.
 *
 * Returns parsed rows with current stock levels for preview.
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { inventory } from '@/lib/db/schema'
import { eq, and, inArray, sql } from 'drizzle-orm'

/** Header name → internal key */
const HEADER_MAP: Record<string, string> = {
  '품목코드': 'sku',
  '상품코드': 'sku',
  'SKU': 'sku',
  '한글품명': 'productName',
  '상품명': 'productName',
  '품명': 'productName',
  '옵션명': 'optionName',
  '단품명': 'optionName',
  '실제 출고 수량': 'quantity',
  '실제출고수량': 'quantity',
  '출고요청수량': 'quantity',
  '수량': 'quantity',
  '입고수량': 'quantity',
  '로케이션': 'sectorCode',
  'Location': 'sectorCode',
  '피킹위치': 'sectorCode',
  '위치': 'sectorCode',
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const obj = v as unknown as Record<string, unknown>
    if ('result' in obj) return String(obj.result ?? '')
    if ('richText' in obj) {
      const parts = obj.richText as Array<{ text?: string }> | undefined
      return parts?.map((p) => p.text ?? '').join('') ?? ''
    }
    if ('text' in obj) return String(obj.text ?? '')
    if ('formula' in obj) return String(obj.result ?? '')
  }
  return String(v).trim()
}

export interface IncomingRow {
  rowNum: number
  sku: string
  productName: string
  optionName: string | null
  quantity: number
  sectorCode: string | null
  note: string
  inventoryExists: boolean
  currentStock: number
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '파일을 읽을 수 없습니다.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file 필드가 없습니다.' }, { status: 400 })
  }

  const arrayBuffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(arrayBuffer)
  } catch {
    return NextResponse.json({ error: 'Excel 파일을 읽을 수 없습니다.' }, { status: 400 })
  }

  // Prefer "제품단위" sheet
  const sheet = workbook.getWorksheet('제품단위') ?? workbook.worksheets[0]
  if (!sheet) {
    return NextResponse.json({ error: 'Excel 시트가 비어있습니다.' }, { status: 400 })
  }

  // Detect header row: find first row where a cell matches known headers
  let headerRowNum = 1
  let colMap: Record<number, string> = {}

  for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
    const map: Record<number, string> = {}
    sheet.getRow(r).eachCell((cell, col) => {
      const key = HEADER_MAP[cellText(cell).replace(/\n/g, '').trim()]
      if (key) map[col] = key
    })
    const vals = Object.values(map)
    if (vals.includes('sku') && vals.includes('quantity')) {
      colMap = map
      headerRowNum = r
      break
    }
  }

  if (!Object.values(colMap).includes('sku')) {
    return NextResponse.json({ error: '품목코드 컬럼을 찾을 수 없습니다.' }, { status: 400 })
  }

  // Parse data rows
  const parsed: Omit<IncomingRow, 'inventoryExists' | 'currentStock'>[] = []
  const dataStartRow = headerRowNum + 1

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < dataStartRow) return

    const raw: Record<string, string> = {}
    row.eachCell((cell, col) => {
      const key = colMap[col]
      if (key) raw[key] = cellText(cell)
    })

    const sku = raw.sku?.trim()
    if (!sku) return

    const qty = Number(raw.quantity ?? 0)
    if (!Number.isFinite(qty) || qty <= 0) return

    parsed.push({
      rowNum: rowNumber,
      sku,
      productName: raw.productName?.trim() || sku,
      optionName: raw.optionName?.trim() || null,
      quantity: Math.round(qty),
      sectorCode: raw.sectorCode?.trim() || null,
      note: '',
    })
  })

  if (parsed.length === 0) {
    return NextResponse.json({ error: '입고 데이터를 찾을 수 없습니다.' }, { status: 400 })
  }

  // Look up current stock for all parsed SKUs
  const skus = [...new Set(parsed.map((r) => r.sku))]
  const stockRecords = await db
    .select({
      sku: inventory.sku,
      totalStock: sql<number>`COALESCE(SUM(${inventory.totalStock}), 0)::int`,
    })
    .from(inventory)
    .where(and(eq(inventory.userId, user.id), inArray(inventory.sku, skus)))
    .groupBy(inventory.sku)

  const stockMap = new Map(stockRecords.map((r) => [r.sku, r.totalStock]))

  const rows: IncomingRow[] = parsed.map((r) => ({
    ...r,
    inventoryExists: stockMap.has(r.sku),
    currentStock: stockMap.get(r.sku) ?? 0,
  }))

  return NextResponse.json({ rows, sheetName: sheet.name })
}
