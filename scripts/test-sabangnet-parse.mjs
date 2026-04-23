/**
 * 사방넷 재고코드관리 엑셀 파싱 검증 — API 내부 로직을 복제해서 에러 없이 몇 건 읽히는지 확인.
 */
import ExcelJS from 'exceljs'

const EXCEL_PATH = '/Users/ian/Downloads/재고코드관리_다운로드.xlsx'

const HEADER_MAP = {
  SKU: 'sku',
  품번: 'sku',
  품목코드: 'sku',
  상품코드: 'sku',
  'SKU(품번)': 'sku',
  상품명: 'productName',
  품목명: 'productName',
  수량: 'totalStock',
  재고: 'totalStock',
  재고수량: 'totalStock',
  '수량(재고)': 'totalStock',
  '현재고 가용': 'totalStock',
  현재고가용: 'totalStock',
  창고: 'warehouseZone',
  창고구분: 'warehouseZone',
  위치: 'sectorCode',
  피킹위치: 'sectorCode',
  창고위치: 'sectorCode',
  '한국창고기준 위치': 'sectorCode',
  섹터: 'sectorCode',
  원가: 'costPrice',
  판매가: 'basePrice',
  택배사: 'carrierId',
}

function cellText(cell) {
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '')
  if (typeof v === 'object' && 'text' in v) return String(v.text ?? '')
  return String(v).trim()
}

function mapSingleRow(sheet, rowNum) {
  const row = sheet.getRow(rowNum)
  const map = {}
  row.eachCell((cell, col) => {
    const key = HEADER_MAP[cellText(cell).replace(/\n/g, '').trim()]
    if (key) map[col] = key
  })
  return map
}

function mapCombinedRows(sheet, topRow, subRow) {
  const top = sheet.getRow(topRow)
  const sub = sheet.getRow(subRow)
  const map = {}
  const maxCol = Math.max(top.cellCount, sub.cellCount, sheet.columnCount)

  const topValues = []
  let last = ''
  for (let col = 1; col <= maxCol; col++) {
    const v = cellText(top.getCell(col)).replace(/\n/g, '').trim()
    if (v) last = v
    topValues[col] = v || last
  }

  for (let col = 1; col <= maxCol; col++) {
    const s = cellText(sub.getCell(col)).replace(/\n/g, '').trim()
    const p = topValues[col]
    const key =
      (s && HEADER_MAP[`${p} ${s}`]) ??
      HEADER_MAP[p] ??
      (s && HEADER_MAP[s])
    if (key) map[col] = key
  }
  return map
}

function hasRequired(map) {
  const vals = Object.values(map)
  return vals.includes('sku') && vals.includes('productName') && vals.includes('totalStock')
}

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(EXCEL_PATH)
const sheet = wb.worksheets[0]

let colMap = mapSingleRow(sheet, 1)
let dataStartRow = 2
console.log('row 1 map:', colMap, 'has required:', hasRequired(colMap))

if (!hasRequired(colMap)) {
  const combined = mapCombinedRows(sheet, 2, 3)
  console.log('row 2+3 combined map:', combined, 'has required:', hasRequired(combined))
  if (hasRequired(combined)) {
    colMap = combined
    dataStartRow = 4
  }
}

console.log('\n--- Final colMap ---')
console.log(colMap)
console.log('Data starts at row:', dataStartRow)

// Parse a few rows
const rows = []
sheet.eachRow((row, rowNumber) => {
  if (rowNumber < dataStartRow) return
  const raw = {}
  row.eachCell((cell, col) => {
    const key = colMap[col]
    if (key) raw[key] = cellText(cell)
  })
  const sku = (raw.sku ?? '').trim()
  const productName = (raw.productName ?? '').trim()
  const stock = Number(raw.totalStock)
  if (!sku) return
  if (!productName) return
  if (!Number.isFinite(stock) || stock < 0) return
  rows.push({ sku, productName, totalStock: Math.round(stock), warehouseZone: raw.warehouseZone })
})

console.log('\n--- First 5 parsed rows ---')
for (const r of rows.slice(0, 5)) {
  console.log(r)
}
console.log('\n--- Last 3 parsed rows ---')
for (const r of rows.slice(-3)) {
  console.log(r)
}
console.log('\nTotal parsed:', rows.length)
