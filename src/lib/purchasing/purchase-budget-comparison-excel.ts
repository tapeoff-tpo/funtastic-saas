import ExcelJS from 'exceljs'
import type { PurchaseBudgetComparison } from './purchase-budget-comparison'

const COLUMNS = [
  { header: '비교 결과', key: 'change', width: 21 },
  { header: '품목코드', key: 'sku', width: 17 },
  { header: '상품명', key: 'productName', width: 30 },
  { header: '옵션명', key: 'optionName', width: 23 },
  { header: '적용 전 수량', key: 'beforeQuantity', width: 15 },
  { header: '무예산 재계산 수량', key: 'baselineQuantity', width: 20 },
  { header: '예산 배정 수량', key: 'allocatedQuantity', width: 16 },
  { header: '적용 후 수량', key: 'afterQuantity', width: 15 },
  { header: '수량 차이', key: 'quantityDifference', width: 14 },
  { header: '총 현재고', key: 'availableStock', width: 14 },
  { header: '진행 발주', key: 'pipelineQuantity', width: 14 },
  { header: '목표수량', key: 'targetStockQuantity', width: 14 },
  { header: '개당 원가(元)', key: 'unitCostYuan', width: 16 },
  { header: '개당 원가(₩)', key: 'unitCostKrw', width: 16 },
  { header: '적용 전 금액(₩)', key: 'beforeCostKrw', width: 20 },
  { header: '적용 후 금액(₩)', key: 'afterCostKrw', width: 20 },
  { header: '금액 차이(₩)', key: 'costDifferenceKrw', width: 18 },
  { header: '변경 요인', key: 'reason', width: 46 },
] as const

export async function exportPurchaseBudgetComparisonExcel(comparison: PurchaseBudgetComparison) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('예산 비교')
  sheet.columns = COLUMNS.map(({ key, width }) => ({ key, width }))
  sheet.views = [{ state: 'frozen', ySplit: 7 }]

  const beforeSkuCount = comparison.rows.filter((row) => row.beforeQuantity > 0).length
  const afterSkuCount = comparison.rows.filter((row) => row.afterQuantity > 0).length
  const excludedCount = comparison.rows.filter((row) => row.change === '제외').length
  const reducedCount = comparison.rows.filter((row) => row.change === '수량 감소').length
  const beforeMissing = comparison.rows.filter((row) => row.beforeQuantity > 0 && row.beforeCostKrw === null).length
  const afterMissing = comparison.rows.filter((row) => row.afterQuantity > 0 && row.afterCostKrw === null).length
  const beforeTotal = comparison.rows.reduce((total, row) => total + (row.beforeCostKrw ?? 0), 0)
  const afterTotal = comparison.rows.reduce((total, row) => total + (row.afterCostKrw ?? 0), 0)

  sheet.mergeCells('A1:G1')
  sheet.getCell('A1').value = '발주 예산 비교'
  sheet.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FF1F2937' } }
  sheet.getRow(1).height = 25
  sheet.addRow([
    '계산 시각', formatKst(comparison.calculatedAt), '목표 보유개월', comparison.targetStockMonths,
    '구매예산(₩)', comparison.budgetKrw, '자동 추천 예산 배정액(₩)', comparison.spentBudgetKrw,
  ])
  sheet.addRow([
    '적용 전 SKU', beforeSkuCount, '적용 후 SKU', afterSkuCount,
    '제외 SKU', excludedCount, '수량 감소 SKU', reducedCount,
  ])
  sheet.addRow([
    '적용 전 확인 금액(₩)', beforeTotal, '원가 미확인 SKU', beforeMissing,
    '적용 후 확인 금액(₩)', afterTotal, '원가 미확인 SKU', afterMissing,
  ])
  sheet.mergeCells('A5:R5')
  sheet.getCell('A5').value = '전후 금액은 계산 시점의 확인된 원가 기준입니다. 수동 검토와 원가 미확정 항목은 예산 밖으로 포함될 수 있습니다.'
  sheet.getCell('A5').font = { size: 10, color: { argb: 'FF92400E' } }
  sheet.mergeCells('A6:R6')
  sheet.getCell('A6').value = '무예산 재계산과 예산 배정은 같은 시점의 자동 추천 기준이며, 적용 전후 수량에는 수동 검토가 포함됩니다.'
  sheet.getCell('A6').font = { size: 10, color: { argb: 'FF4B5563' } }
  for (const rowNumber of [2, 3, 4]) {
    for (const column of [1, 3, 5, 7]) {
      sheet.getRow(rowNumber).getCell(column).font = { bold: true, color: { argb: 'FF4B5563' } }
    }
  }
  for (const address of ['F2', 'H2', 'B4', 'F4']) sheet.getCell(address).numFmt = '#,##0'

  const header = sheet.getRow(7)
  header.values = COLUMNS.map((column) => column.header)
  header.height = 25
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  sheet.autoFilter = { from: 'A7', to: { row: 7, column: COLUMNS.length } }

  for (const item of comparison.rows) {
    const row = sheet.addRow(item)
    row.alignment = { vertical: 'middle' }
    if (item.change === '제외' || item.change === '수량 감소' || item.change === '예산 제외(신규 후보)' || item.change === '반영 확인 필요') {
      row.getCell('change').font = { bold: true, color: { argb: 'FFC2410C' } }
    }
  }
  for (const key of [
    'beforeQuantity', 'baselineQuantity', 'allocatedQuantity', 'afterQuantity', 'quantityDifference',
    'availableStock', 'pipelineQuantity', 'targetStockQuantity', 'unitCostKrw', 'beforeCostKrw', 'afterCostKrw', 'costDifferenceKrw',
  ]) sheet.getColumn(key).numFmt = '#,##0;[Red]-#,##0'
  sheet.getColumn('unitCostYuan').numFmt = '#,##0.00'
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

function formatKst(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}
