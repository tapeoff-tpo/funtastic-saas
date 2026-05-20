import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { and, eq, inArray } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { inventory } from '@/lib/db/schema'
import type { AdjustmentReason } from '@/lib/inventory/types'

export const runtime = 'nodejs'

const HEADER_MAP: Record<string, string> = {
  상품코드: 'sku',
  품목코드: 'sku',
  SKU: 'sku',
  sku: 'sku',
  창고: 'warehouseZone',
  창고구분: 'warehouseZone',
  창고명: 'warehouseZone',
  로케이션: 'sectorCode',
  피킹위치: 'sectorCode',
  위치: 'sectorCode',
  Location: 'sectorCode',
  location: 'sectorCode',
  변동수량: 'delta',
  조정수량: 'delta',
  수량: 'delta',
  사유: 'reason',
  조정사유: 'reason',
  메모: 'note',
  비고: 'note',
}

const REASON_MAP: Record<string, AdjustmentReason> = {
  입고: 'incoming',
  incoming: 'incoming',
  출고: 'order_ship',
  출고차감: 'order_ship',
  order_ship: 'order_ship',
  실사: 'physical_count',
  실사조정: 'physical_count',
  physical_count: 'physical_count',
  불량: 'defective',
  불용: 'defective',
  '불용/불량': 'defective',
  defective: 'defective',
  기타: 'other',
  other: 'other',
}

type ParsedRow = {
  rowNum: number
  sku: string
  warehouseZone: string | null
  sectorCode: string | null
  delta: number
  reason: AdjustmentReason
  note: string
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    const obj = v as unknown as Record<string, unknown>
    if ('result' in obj) return String(obj.result ?? '').trim()
    if ('richText' in obj) {
      const parts = obj.richText as Array<{ text?: string }> | undefined
      return parts?.map((p) => p.text ?? '').join('').trim() ?? ''
    }
    if ('text' in obj) return String(obj.text ?? '').trim()
    if ('formula' in obj) return String(obj.result ?? '').trim()
  }
  return String(v).trim()
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, '').replace(/\n/g, '')
}

function keyOf(sku: string, warehouseZone: string | null, sectorCode: string | null) {
  return `${sku}::${warehouseZone ?? ''}::${sectorCode ?? ''}`
}

function parseReason(value: string): AdjustmentReason {
  return REASON_MAP[value.trim()] ?? 'other'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

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

  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'Excel 파일을 읽을 수 없습니다. xlsx 형식인지 확인해주세요.' }, { status: 400 })
  }

  const sheet = workbook.worksheets[0]
  if (!sheet) {
    return NextResponse.json({ error: 'Excel 시트가 비어있습니다.' }, { status: 400 })
  }

  let headerRowNum = 1
  let colMap: Record<number, string> = {}
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r += 1) {
    const map: Record<number, string> = {}
    sheet.getRow(r).eachCell((cell, col) => {
      const key = HEADER_MAP[normalizeHeader(cellText(cell))]
      if (key) map[col] = key
    })
    const values = Object.values(map)
    if (values.includes('sku') && values.includes('delta')) {
      headerRowNum = r
      colMap = map
      break
    }
  }

  const mappedKeys = Object.values(colMap)
  if (!mappedKeys.includes('sku') || !mappedKeys.includes('delta')) {
    return NextResponse.json({ error: '상품코드와 변동수량 컬럼을 찾을 수 없습니다.' }, { status: 400 })
  }

  const parsed: ParsedRow[] = []
  const errors: Array<{ rowNum: number; sku: string; error: string }> = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNum) return

    const raw: Record<string, string> = {}
    row.eachCell((cell, col) => {
      const key = colMap[col]
      if (key) raw[key] = cellText(cell)
    })

    const sku = raw.sku?.trim()
    if (!sku) return

    const delta = Number(String(raw.delta ?? '').replace(/,/g, '').trim())
    if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
      errors.push({ rowNum: rowNumber, sku, error: '변동수량은 0이 아닌 정수여야 합니다.' })
      return
    }

    parsed.push({
      rowNum: rowNumber,
      sku,
      warehouseZone: raw.warehouseZone?.trim() || null,
      sectorCode: raw.sectorCode?.trim() || null,
      delta,
      reason: parseReason(raw.reason ?? ''),
      note: raw.note?.trim() ?? '',
    })
  })

  if (parsed.length === 0 && errors.length === 0) {
    return NextResponse.json({ error: '재고조정 데이터를 찾을 수 없습니다.' }, { status: 400 })
  }

  const skus = [...new Set([...parsed.map((row) => row.sku), ...errors.map((row) => row.sku)])]
  const inventoryRows = skus.length > 0
    ? await db
        .select({
          id: inventory.id,
          sku: inventory.sku,
          productName: inventory.productName,
          optionName: inventory.optionName,
          warehouseZone: inventory.warehouseZone,
          sectorCode: inventory.sectorCode,
          totalStock: inventory.totalStock,
        })
        .from(inventory)
        .where(and(eq(inventory.userId, workspaceUserId), inArray(inventory.sku, skus)))
    : []

  const exactMap = new Map(
    inventoryRows.map((row) => [keyOf(row.sku, row.warehouseZone, row.sectorCode), row]),
  )
  const rowsBySku = new Map<string, typeof inventoryRows>()
  for (const row of inventoryRows) {
    rowsBySku.set(row.sku, [...(rowsBySku.get(row.sku) ?? []), row])
  }

  const rows = [
    ...parsed.map((row) => {
      let matched = exactMap.get(keyOf(row.sku, row.warehouseZone, row.sectorCode))
      let error: string | undefined

      if (!matched && !row.warehouseZone && !row.sectorCode) {
        const skuRows = rowsBySku.get(row.sku) ?? []
        if (skuRows.length === 1) {
          matched = skuRows[0]
        } else if (skuRows.length > 1) {
          error = '같은 상품코드가 여러 창고/로케이션에 있습니다. 창고와 로케이션을 입력해주세요.'
        }
      }

      if (!matched && !error) error = '재고관리에서 해당 상품코드/창고/로케이션을 찾을 수 없습니다.'

      return {
        ...row,
        productName: matched?.productName ?? row.sku,
        optionName: matched?.optionName ?? null,
        warehouseZone: matched?.warehouseZone ?? row.warehouseZone,
        sectorCode: matched?.sectorCode ?? row.sectorCode,
        inventoryExists: !!matched,
        currentStock: matched?.totalStock ?? 0,
        error,
      }
    }),
    ...errors.map((row) => ({
      rowNum: row.rowNum,
      sku: row.sku,
      productName: row.sku,
      optionName: null,
      warehouseZone: null,
      sectorCode: null,
      delta: 0,
      reason: 'other' as AdjustmentReason,
      note: '',
      inventoryExists: false,
      currentStock: 0,
      error: row.error,
    })),
  ].sort((a, b) => a.rowNum - b.rowNum)

  return NextResponse.json({ rows, sheetName: sheet.name })
}
