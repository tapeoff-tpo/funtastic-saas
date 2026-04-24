/**
 * 택배사 미지정 상품 Excel 내보내기/가져오기.
 *
 * 용도: `products.default_carrier_id IS NULL` 인 상품을 엑셀로 뽑아
 * 사용자가 택배사를 채워 다시 업로드하면 일괄 적용한다.
 *
 * 택배사 코드: cj, kyungdong, daesin, self (자체배송).
 * self 는 default_carrier_id 를 null 로 유지 (배정 안 됨과 구분 위해 업로드 시에만 허용).
 */

import ExcelJS from 'exceljs'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'
import { and, eq, isNull, sql as dsql } from 'drizzle-orm'

const CARRIER_OPTIONS = ['CJ대한통운', '경동택배', '대신화물택배', '자체배송'] as const

const LABEL_TO_CODE: Record<string, string | null> = {
  'CJ대한통운': 'cj',
  'CJ': 'cj',
  'cj': 'cj',
  '경동택배': 'kyungdong',
  '경동': 'kyungdong',
  'kyungdong': 'kyungdong',
  '대신화물택배': 'daesin',
  '대신': 'daesin',
  'daesin': 'daesin',
  '자체배송': null,
  '자체': null,
  'self': null,
}

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE0E0E0' },
}

export async function exportUnassignedCarriersToExcel(userId: string): Promise<Buffer> {
  const rows = await db
    .select({
      sku: products.internalSku,
      name: products.name,
      categoryId: products.categoryId,
      warehouseLocation: products.warehouseLocation,
    })
    .from(products)
    .where(
      and(
        eq(products.userId, userId),
        isNull(products.defaultCarrierId),
        dsql`${products.status} <> 'deleted'`,
      ),
    )
    .orderBy(products.internalSku)

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('택배사 지정')

  ws.columns = [
    { header: '상품코드', key: 'sku', width: 15 },
    { header: '상품명', key: 'name', width: 40 },
    { header: '카테고리', key: 'categoryId', width: 15 },
    { header: '창고위치', key: 'warehouseLocation', width: 20 },
    { header: '택배사', key: 'carrier', width: 18 },
  ]

  const header = ws.getRow(1)
  header.eachCell((c) => {
    c.font = { bold: true }
    c.fill = HEADER_FILL
    c.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    }
  })

  for (const r of rows) {
    ws.addRow({
      sku: r.sku,
      name: r.name,
      categoryId: r.categoryId ?? '',
      warehouseLocation: r.warehouseLocation ?? '',
      carrier: '',
    })
  }

  // 택배사 셀 드롭다운 (E열). 최대 5000행까지.
  const maxRow = Math.max(rows.length + 1, 2)
  ws.dataValidations.add(`E2:E${maxRow + 1000}`, {
    type: 'list',
    allowBlank: true,
    formulae: [`"${CARRIER_OPTIONS.join(',')}"`],
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: '택배사 선택',
    error: 'CJ대한통운 / 경동택배 / 대신화물택배 / 자체배송 중 하나를 선택하세요.',
  })

  // 안내 시트
  const info = wb.addWorksheet('안내')
  info.columns = [{ header: '', key: 'v', width: 80 }]
  const lines = [
    '택배사 일괄 지정 사용법',
    '',
    '1. "택배사 지정" 시트의 E열(택배사)에 드롭다운으로 택배사를 선택하세요.',
    '2. 빈 행은 건너뜁니다. 일부만 채워도 됩니다.',
    '3. 저장 후 상품 관리 페이지에서 다시 업로드하세요.',
    '',
    '택배사 옵션:',
    '  - CJ대한통운',
    '  - 경동택배',
    '  - 대신화물택배',
    '  - 자체배송 (택배 배정 안 됨으로 유지)',
  ]
  for (const line of lines) info.addRow({ v: line })
  info.getRow(1).font = { bold: true, size: 12 }

  const buf = await wb.xlsx.writeBuffer()
  return buf as unknown as Buffer
}

export interface CarrierImportResult {
  totalRows: number
  updated: number
  skipped: number
  errors: Array<{ row: number; sku: string; reason: string }>
}

export async function applyCarrierImport(
  userId: string,
  fileBuffer: ArrayBuffer,
): Promise<CarrierImportResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(fileBuffer)
  const ws = wb.getWorksheet('택배사 지정') ?? wb.worksheets[0]
  if (!ws) throw new Error('시트를 찾을 수 없습니다')

  // Collect SKU → carrier from rows (skip header row 1)
  const assignments: Array<{ row: number; sku: string; carrier: string | null }> = []
  const errors: CarrierImportResult['errors'] = []
  const skuByCarrier: Record<string, string[]> = { cj: [], kyungdong: [], daesin: [] }

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const skuCell = row.getCell(1).value
    const carrierCell = row.getCell(5).value
    const sku = typeof skuCell === 'string' ? skuCell.trim() : skuCell ? String(skuCell).trim() : ''
    const carrierLabel = typeof carrierCell === 'string'
      ? carrierCell.trim()
      : carrierCell ? String(carrierCell).trim() : ''
    if (!sku || !carrierLabel) return
    if (!(carrierLabel in LABEL_TO_CODE)) {
      errors.push({ row: rowNumber, sku, reason: `알 수 없는 택배사: ${carrierLabel}` })
      return
    }
    const code = LABEL_TO_CODE[carrierLabel]
    assignments.push({ row: rowNumber, sku, carrier: code })
    if (code) skuByCarrier[code].push(sku)
  })

  let updated = 0
  for (const [code, skus] of Object.entries(skuByCarrier)) {
    if (skus.length === 0) continue
    const res = await db
      .update(products)
      .set({ defaultCarrierId: code, updatedAt: new Date() })
      .where(and(eq(products.userId, userId), dsql`${products.internalSku} = ANY(${skus})`))
    // drizzle-orm postgres-js returns { rowCount }
    updated += (res as unknown as { rowCount?: number }).rowCount ?? 0
  }
  // 자체배송 (code=null) → 변경 없이 스킵 집계만
  const selfCount = assignments.filter((a) => a.carrier === null).length

  return {
    totalRows: assignments.length + selfCount,
    updated,
    skipped: selfCount + (assignments.length - updated - errors.length > 0
      ? assignments.length - updated - errors.length
      : 0),
    errors,
  }
}
