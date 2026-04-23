/**
 * GET /api/inventory/export?skus=sku1,sku2,...
 *
 * 재고현황 엑셀 다운로드.
 * skus 파라미터 없으면 전체 다운로드, 있으면 선택 다운로드.
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

  const conditions = [eq(products.userId, user.id), ne(products.status, 'deleted')]
  if (skus && skus.length > 0) {
    conditions.push(inArray(products.internalSku, skus))
  }

  const rows = await db
    .select({
      sku: products.internalSku,
      productName: products.name,
      optionName: productVariants.optionName,
      warehouseZone: inventory.warehouseZone,
      sectorCode: sql<string | null>`COALESCE(${products.warehouseLocation}, ${inventory.sectorCode})`,
      totalStock: sql<number>`COALESCE(${inventory.totalStock}, 0)::int`,
      reservedStock: sql<number>`COALESCE(${inventory.reservedStock}, 0)::int`,
      availableStock: sql<number>`COALESCE(${inventory.availableStock}, 0)::int`,
      monthlyIncoming: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryHistory.adjustmentReason} = 'incoming' AND date_trunc('month', ${inventoryHistory.createdAt}) = date_trunc('month', NOW()) THEN ${inventoryHistory.delta} ELSE 0 END), 0)::int`,
      monthlyOutgoing: sql<number>`COALESCE(SUM(CASE WHEN ${inventoryHistory.adjustmentReason} = 'order_ship' AND date_trunc('month', ${inventoryHistory.createdAt}) = date_trunc('month', NOW()) THEN ABS(${inventoryHistory.delta}) ELSE 0 END), 0)::int`,
      lastIncomingAt: sql<Date | null>`MAX(CASE WHEN ${inventoryHistory.adjustmentReason} = 'incoming' THEN ${inventoryHistory.createdAt} END)`,
      lastOutgoingAt: sql<Date | null>`MAX(CASE WHEN ${inventoryHistory.adjustmentReason} = 'order_ship' THEN ${inventoryHistory.createdAt} END)`,
    })
    .from(products)
    .leftJoin(inventory, and(eq(inventory.sku, products.internalSku), eq(inventory.userId, products.userId)))
    .leftJoin(inventoryHistory, eq(inventoryHistory.inventoryId, inventory.id))
    .leftJoin(productVariants, and(eq(productVariants.productId, products.id), eq(productVariants.sku, products.internalSku)))
    .where(and(...conditions))
    .groupBy(products.id, inventory.id, productVariants.id)
    .orderBy(products.internalSku)

  // Build Excel
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('재고현황')

  sheet.columns = [
    { header: 'No.', key: 'no', width: 6 },
    { header: '상품코드', key: 'sku', width: 18 },
    { header: '상품명', key: 'productName', width: 32 },
    { header: '옵션명', key: 'optionName', width: 20 },
    { header: '창고', key: 'warehouseZone', width: 10 },
    { header: '피킹위치', key: 'sectorCode', width: 14 },
    { header: '총재고', key: 'totalStock', width: 8 },
    { header: '예약', key: 'reservedStock', width: 8 },
    { header: '가용', key: 'availableStock', width: 8 },
    { header: '당월입고', key: 'monthlyIncoming', width: 10 },
    { header: '당월출고', key: 'monthlyOutgoing', width: 10 },
    { header: '최종입고일', key: 'lastIncomingAt', width: 14 },
    { header: '최종출고일', key: 'lastOutgoingAt', width: 14 },
  ]

  // Style header row
  const headerRow = sheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EDF2' } }
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    }
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
      warehouseZone: row.warehouseZone ?? '',
      sectorCode: row.sectorCode ?? '',
      totalStock: row.totalStock,
      reservedStock: row.reservedStock,
      availableStock: row.availableStock,
      monthlyIncoming: row.monthlyIncoming,
      monthlyOutgoing: row.monthlyOutgoing,
      lastIncomingAt: fmt(row.lastIncomingAt),
      lastOutgoingAt: fmt(row.lastOutgoingAt),
    })
    r.height = 16
    r.eachCell((cell) => {
      cell.font = { size: 10 }
      cell.alignment = { vertical: 'middle' }
    })
    // Alternating row color
    if (i % 2 === 1) {
      r.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } }
      })
    }
  })

  // Freeze top row
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = skus ? `inventory_selected_${dateStr}.xlsx` : `inventory_${dateStr}.xlsx`

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
