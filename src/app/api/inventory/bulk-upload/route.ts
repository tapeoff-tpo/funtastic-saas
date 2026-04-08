/**
 * POST /api/inventory/bulk-upload
 *
 * Accepts a multipart FormData with a single `file` field (xlsx).
 * Parses the Excel, upserts inventory records via setStock,
 * and returns a summary { total, success, failed, errors }.
 *
 * Required columns: SKU(품번), 상품명, 수량(재고)
 * Optional columns: 창고, 위치(피킹위치)
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'
import { setStock } from '@/lib/inventory/actions'

/** Korean header → internal key */
const HEADER_MAP: Record<string, string> = {
  'SKU': 'sku',
  '품번': 'sku',
  'SKU(품번)': 'sku',
  '상품명': 'productName',
  '수량': 'totalStock',
  '재고': 'totalStock',
  '재고수량': 'totalStock',
  '수량(재고)': 'totalStock',
  '창고': 'warehouseZone',
  '창고구분': 'warehouseZone',
  '위치': 'sectorCode',
  '피킹위치': 'sectorCode',
  '섹터': 'sectorCode',
}

interface ParsedRow {
  sku: string
  productName: string
  totalStock: number
  warehouseZone?: string
  sectorCode?: string
}

interface UploadResult {
  total: number
  success: number
  failed: number
  errors: Array<{ sku: string; error: string }>
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && 'result' in v) return String((v as ExcelJS.CellFormulaValue).result ?? '')
  if (typeof v === 'object' && 'text' in v) return String((v as ExcelJS.CellRichTextValue).text ?? '')
  return String(v).trim()
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  // Parse multipart form
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

  // Read file buffer
  const buffer = Buffer.from(await file.arrayBuffer())

  // Parse Excel
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer)
  } catch {
    return NextResponse.json({ error: 'Excel 파일을 읽을 수 없습니다. xlsx 형식인지 확인해주세요.' }, { status: 400 })
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) {
    return NextResponse.json({ error: 'Excel 시트가 비어있습니다.' }, { status: 400 })
  }

  // Detect header row (row 1)
  const headerRow = sheet.getRow(1)
  const colMap: Record<number, string> = {}
  headerRow.eachCell((cell, colNumber) => {
    const header = cellText(cell)
    const key = HEADER_MAP[header]
    if (key) colMap[colNumber] = key
  })

  if (!Object.values(colMap).includes('sku')) {
    return NextResponse.json(
      { error: 'SKU 또는 품번 컬럼을 찾을 수 없습니다.' },
      { status: 400 },
    )
  }
  if (!Object.values(colMap).includes('productName')) {
    return NextResponse.json(
      { error: '상품명 컬럼을 찾을 수 없습니다.' },
      { status: 400 },
    )
  }
  if (!Object.values(colMap).includes('totalStock')) {
    return NextResponse.json(
      { error: '수량 또는 재고 컬럼을 찾을 수 없습니다.' },
      { status: 400 },
    )
  }

  // Parse data rows
  const rows: ParsedRow[] = []
  const parseErrors: Array<{ sku: string; error: string }> = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return // Skip header

    const raw: Record<string, string> = {}
    row.eachCell((cell, colNumber) => {
      const key = colMap[colNumber]
      if (key) raw[key] = cellText(cell)
    })

    const sku = (raw.sku ?? '').trim()
    const productName = (raw.productName ?? '').trim()
    const stockRaw = raw.totalStock ?? ''
    const totalStock = Number(stockRaw)

    if (!sku) return // blank row, skip silently

    if (!productName) {
      parseErrors.push({ sku, error: '상품명이 비어있습니다.' })
      return
    }
    if (!Number.isFinite(totalStock) || totalStock < 0) {
      parseErrors.push({ sku, error: `수량이 유효하지 않습니다: "${stockRaw}"` })
      return
    }

    rows.push({
      sku,
      productName,
      totalStock: Math.round(totalStock),
      warehouseZone: raw.warehouseZone?.trim() || undefined,
      sectorCode: raw.sectorCode?.trim() || undefined,
    })
  })

  // Upsert each row
  let successCount = 0
  const dbErrors: Array<{ sku: string; error: string }> = []

  for (const row of rows) {
    const result = await setStock(user.id, row.sku, row.productName, row.totalStock, {
      warehouseZone: row.warehouseZone,
      sectorCode: row.sectorCode,
    })
    if (result.success) {
      successCount++
    } else {
      dbErrors.push({ sku: row.sku, error: result.error ?? '저장 중 오류가 발생했습니다.' })
    }
  }

  const allErrors = [...parseErrors, ...dbErrors]
  const result: UploadResult = {
    total: rows.length + parseErrors.length,
    success: successCount,
    failed: parseErrors.length + dbErrors.length,
    errors: allErrors,
  }

  return NextResponse.json(result)
}
