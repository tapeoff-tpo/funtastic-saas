/**
 * GET /api/inventory/export?skus=...&year=2026&month=4
 *
 * 재고현황 엑셀 다운로드.
 * - skus: 쉼표구분 SKU (없으면 전체)
 * - year/month: 조회 월 (없으면 당월)
 */

import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { inventory, inventoryHistory, products, productVariants } from '@/lib/db/schema'
import { eq, and, ne, sql, inArray } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const skusParam = req.nextUrl.searchParams.get('skus')
  const skus = skusParam ? skusParam.split(',').filter(Boolean) : null

  const now = new Date()
  const year = parseInt(req.nextUrl.searchParams.get('year') ?? String(now.getFullYear()), 10)
  const month = parseInt(req.nextUrl.searchParams.get('month') ?? String(now.getMonth() + 1), 10)

  // Build month range in KST (UTC+9)
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01 00:00:00+09`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01 00:00:00+09`

  const conditions = [
    eq(products.userId, user.id),
    eq(inventory.userId, user.id),
    ne(products.status, 'deleted'),
    eq(productVariants.isActive, true),
  ]
  if (skus && skus.length > 0) {
    conditions.push(inArray(inventory.sku, skus))
  }

  const rows = await db
    .select({
      sku: inventory.sku,
      productName: inventory.productName,
      optionName: inventory.optionName,
      packagingUnit: inventory.packagingUnit,
      warehouseZone: inventory.warehouseZone,
      sectorCode: inventory.sectorCode,
      totalStock: sql<number>`COALESCE(${inventory.totalStock}, 0)::int`,
      reservedStock: sql<number>`COALESCE(${inventory.reservedStock}, 0)::int`,
      availableStock: sql<number>`COALESCE(${inventory.availableStock}, 0)::int`,
      monthlyIncoming: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryHistory.adjustmentReason} = 'incoming' AND ${inventoryHistory.createdAt} >= ${monthStart}::timestamptz AND ${inventoryHistory.createdAt} < ${monthEnd}::timestamptz THEN ${inventoryHistory.delta} ELSE 0 END), 0)::int`,
      monthlyOutgoing: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryHistory.adjustmentReason} = 'order_ship' AND ${inventoryHistory.createdAt} >= ${monthStart}::timestamptz AND ${inventoryHistory.createdAt} < ${monthEnd}::timestamptz THEN ABS(${inventoryHistory.delta}) ELSE 0 END), 0)::int`,
      lastIncomingAt: sql<Date | null>`MAX(CASE WHEN ${inventoryHistory.adjustmentReason} = 'incoming' AND ${inventoryHistory.createdAt} >= ${monthStart}::timestamptz AND ${inventoryHistory.createdAt} < ${monthEnd}::timestamptz THEN ${inventoryHistory.createdAt} END)`,
      lastOutgoingAt: sql<Date | null>`MAX(CASE WHEN ${inventoryHistory.adjustmentReason} = 'order_ship' AND ${inventoryHistory.createdAt} >= ${monthStart}::timestamptz AND ${inventoryHistory.createdAt} < ${monthEnd}::timestamptz THEN ${inventoryHistory.createdAt} END)`,
    })
    .from(inventory)
    .innerJoin(productVariants, eq(productVariants.sku, inventory.sku))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventoryHistory, eq(inventoryHistory.inventoryId, inventory.id))
    .where(and(...conditions))
    .groupBy(products.id, inventory.id)
    .orderBy(inventory.sku)

  const monthLabel = `${year}년 ${month}월`

  // Build Excel
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(`재고현황_${year}${String(month).padStart(2, '0')}`)

  sheet.columns = [
    { header: 'No.', key: 'no', width: 6 },
    { header: '상품코드', key: 'sku', width: 18 },
    { header: '상품명', key: 'productName', width: 32 },
    { header: '옵션명', key: 'optionName', width: 20 },
    { header: '포장', key: 'packagingUnit', width: 14 },
    { header: '창고', key: 'warehouseZone', width: 10 },
    { header: '피킹위치', key: 'sectorCode', width: 14 },
    { header: '현재고(총)', key: 'totalStock', width: 10 },
    { header: '예약', key: 'reservedStock', width: 8 },
    { header: '가용', key: 'availableStock', width: 8 },
    { header: `${monthLabel} 입고`, key: 'monthlyIncoming', width: 14 },
    { header: `${monthLabel} 출고`, key: 'monthlyOutgoing', width: 14 },
    { header: '최종입고일', key: 'lastIncomingAt', width: 14 },
    { header: '최종출고일', key: 'lastOutgoingAt', width: 14 },
  ]

  // Style header row
  const headerRow = sheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EDF2' } }
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } }
  })
  headerRow.height = 18

  const fmt = (d: Date | null | undefined) =>
    d ? new Date(d).toLocaleDateString('ko-KR') : ''

  rows.forEach((row, i) => {
    const r = sheet.addRow({
      no: i + 1,
      sku: row.sku,
      productName: row.productName,
      optionName: row.optionName ?? '',
      packagingUnit: row.packagingUnit ?? '',
      warehouseZone: row.warehouseZone ?? '',
      sectorCode: row.sectorCode ?? '',
      totalStock: row.totalStock,
      reservedStock: row.reservedStock,
      availableStock: row.availableStock,
      monthlyIncoming: row.monthlyIncoming || '',
      monthlyOutgoing: row.monthlyOutgoing || '',
      lastIncomingAt: fmt(row.lastIncomingAt),
      lastOutgoingAt: fmt(row.lastOutgoingAt),
    })
    r.height = 16
    r.eachCell((cell) => {
      cell.font = { size: 10 }
      cell.alignment = { vertical: 'middle' }
    })
    if (i % 2 === 1) {
      r.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } }
      })
    }
  })

  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const suffix = skus ? '_선택' : '_전체'
  const filename = `재고현황_${year}${String(month).padStart(2, '0')}${suffix}.xlsx`

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
