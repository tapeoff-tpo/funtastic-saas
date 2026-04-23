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
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

/** Korean header → internal key (also supports 사방넷 multi-row headers like "현재고 가용") */
const HEADER_MAP: Record<string, string> = {
  'SKU': 'sku',
  '품번': 'sku',
  '품목코드': 'sku',
  '상품코드': 'sku',
  'SKU(품번)': 'sku',
  '상품명': 'productName',
  '품목명': 'productName',
  '수량': 'totalStock',
  '재고': 'totalStock',
  '재고수량': 'totalStock',
  '수량(재고)': 'totalStock',
  '현재고 가용': 'totalStock', // 사방넷 재고코드관리 format
  '현재고가용': 'totalStock',
  '창고': 'warehouseZone',
  '창고구분': 'warehouseZone',
  '위치': 'sectorCode',
  '피킹위치': 'sectorCode',
  '창고위치': 'sectorCode',
  '한국창고기준 위치': 'sectorCode',
  '섹터': 'sectorCode',
  '원가': 'costPrice',
  '판매가': 'basePrice',
  '택배사': 'carrierId',
}

/** Build a column map for a single header row */
function mapSingleRow(sheet: ExcelJS.Worksheet, rowNum: number): Record<number, string> {
  const row = sheet.getRow(rowNum)
  const map: Record<number, string> = {}
  row.eachCell((cell, col) => {
    const key = HEADER_MAP[cellText(cell).replace(/\n/g, '').trim()]
    if (key) map[col] = key
  })
  return map
}

/** Build a column map for combined row N + row N+1 headers (merged parents + sub-headers) */
function mapCombinedRows(sheet: ExcelJS.Worksheet, topRow: number, subRow: number): Record<number, string> {
  const top = sheet.getRow(topRow)
  const sub = sheet.getRow(subRow)
  const map: Record<number, string> = {}
  const maxCol = Math.max(top.cellCount, sub.cellCount, sheet.columnCount)

  // Forward-fill the top row for merged cells — value carries across empty continuations
  const topValues: string[] = []
  let last = ''
  for (let col = 1; col <= maxCol; col++) {
    const v = cellText(top.getCell(col)).replace(/\n/g, '').trim()
    if (v) last = v
    topValues[col] = v || last
  }

  for (let col = 1; col <= maxCol; col++) {
    const s = cellText(sub.getCell(col)).replace(/\n/g, '').trim()
    const p = topValues[col]
    // Try "parent sub" combined, then parent alone, then sub alone
    const key =
      (s && HEADER_MAP[`${p} ${s}`]) ??
      HEADER_MAP[p] ??
      (s && HEADER_MAP[s])
    if (key) map[col] = key
  }
  return map
}

function hasRequired(map: Record<number, string>): boolean {
  const vals = Object.values(map)
  return vals.includes('sku') && vals.includes('productName') && vals.includes('totalStock')
}

interface ParsedRow {
  sku: string
  productName: string
  totalStock: number
  warehouseZone?: string
  sectorCode?: string
  costPrice?: string
  basePrice?: string
  carrierId?: string
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

  // Detect header layout — try row 1 (standard), then row 2+3 combined (사방넷 format)
  let colMap = mapSingleRow(sheet, 1)
  let dataStartRow = 2
  if (!hasRequired(colMap)) {
    const sabangnetMap = mapCombinedRows(sheet, 2, 3)
    if (hasRequired(sabangnetMap)) {
      colMap = sabangnetMap
      dataStartRow = 4
    }
  }

  if (!hasRequired(colMap)) {
    const missing: string[] = []
    const vals = Object.values(colMap)
    if (!vals.includes('sku')) missing.push('상품코드/SKU')
    if (!vals.includes('productName')) missing.push('상품명')
    if (!vals.includes('totalStock')) missing.push('수량/현재고')
    return NextResponse.json(
      { error: `다음 컬럼을 찾을 수 없습니다: ${missing.join(', ')}` },
      { status: 400 },
    )
  }

  // Parse data rows
  const rows: ParsedRow[] = []
  const parseErrors: Array<{ sku: string; error: string }> = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < dataStartRow) return // Skip header rows

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
      costPrice: raw.costPrice?.trim() || undefined,
      basePrice: raw.basePrice?.trim() || undefined,
      carrierId: raw.carrierId?.trim() || undefined,
    })
  })

  // Upsert each row (inventory)
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

  // Sync products table — create or update products for each row
  try {
    const skus = rows.map((r) => r.sku)
    if (skus.length > 0) {
      const existingProducts = await db
        .select({ id: products.id, internalSku: products.internalSku })
        .from(products)
        .where(and(eq(products.userId, user.id), inArray(products.internalSku, skus)))
      const existingSet = new Set(existingProducts.map((p) => p.internalSku))

      const toInsert: Array<typeof products.$inferInsert> = []
      for (const row of rows) {
        const location = [row.warehouseZone, row.sectorCode].filter(Boolean).join(' ').trim() || null
        if (existingSet.has(row.sku)) {
          // Update existing product with info from Excel
          await db
            .update(products)
            .set({
              name: row.productName,
              ...(location ? { warehouseLocation: location } : {}),
              ...(row.costPrice ? { costPrice: row.costPrice } : {}),
              ...(row.basePrice ? { basePrice: row.basePrice } : {}),
              ...(row.carrierId ? { defaultCarrierId: row.carrierId } : {}),
              updatedAt: new Date(),
            })
            .where(and(eq(products.userId, user.id), eq(products.internalSku, row.sku)))
        } else {
          // Insert new product
          toInsert.push({
            userId: user.id,
            internalSku: row.sku,
            name: row.productName,
            basePrice: row.basePrice ?? '0',
            costPrice: row.costPrice ?? null,
            warehouseLocation: location,
            defaultCarrierId: row.carrierId ?? null,
            status: 'active',
          })
        }
      }

      if (toInsert.length > 0) {
        await db.insert(products).values(toInsert).onConflictDoNothing()
      }
    }
  } catch (err) {
    console.error('Product sync failed:', err)
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
