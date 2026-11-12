import ExcelJS from 'exceljs'
import { normalizeExcelWorkbookBuffer } from '@/lib/orders/excel-workbook-buffer'

export type ShortMeetingUploadItem = {
  sku: string
  productName: string
  optionName: string
  quantity: number
}

export type ShortMeetingUpload = {
  /** Number of source rows included in the SKU totals. */
  rowCount: number
  productCount: number
  totalQuantity: number
  warnings: string[]
  items: ShortMeetingUploadItem[]
}

const HEADERS = {
  sku: '사방넷 상품코드',
  productName: '사방넷 상품명',
  optionName: '사방넷 옵션',
  quantity: '실 출고수량',
} as const

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value == null) return ''
  if (typeof value === 'object') {
    if ('result' in value) return value.result == null ? '' : String(value.result).trim()
    if ('richText' in value) return value.richText.map((part) => part.text).join('').trim()
    if ('text' in value) return String(value.text).trim()
    return ''
  }
  return String(value).trim()
}

function quantityValue(cell: ExcelJS.Cell): number | null {
  const text = cellText(cell)
  if (!text || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null
  const value = Number(text.replace(/,/g, ''))
  return Number.isSafeInteger(value) ? value : null
}

/** Parse the first sheet as a complete meeting snapshot, without filtering order dates. */
export async function parseShortMeetingWorkbook(buffer: Buffer): Promise<ShortMeetingUpload> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(normalizeExcelWorkbookBuffer(buffer) as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('엑셀에 워크시트가 없습니다.')
  const header = sheet.getRow(1)
  const columns = new Map<string, number>()
  header.eachCell((cell, column) => {
    const name = cellText(cell).replace(/\s+/g, '')
    if (name && !columns.has(name)) columns.set(name, column)
  })
  const missing = Object.values(HEADERS).filter((name) => !columns.has(name.replace(/\s+/g, '')))
  if (missing.length) throw new Error(`필수 열을 찾을 수 없습니다: ${missing.join(', ')}`)
  const column = (name: string) => columns.get(name.replace(/\s+/g, ''))!
  const skuColumn = column(HEADERS.sku)
  const productColumn = column(HEADERS.productName)
  const optionColumn = column(HEADERS.optionName)
  const quantityColumn = column(HEADERS.quantity)
  const items = new Map<string, ShortMeetingUploadItem>()
  const warnings: string[] = []
  let rowCount = 0
  let totalQuantity = 0

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const sku = cellText(row.getCell(skuColumn))
    const productName = cellText(row.getCell(productColumn))
    const optionName = cellText(row.getCell(optionColumn))
    const quantityText = cellText(row.getCell(quantityColumn))
    // Ignore a completely blank relevant row, including Excel formatting-only rows.
    if (!sku && !productName && !optionName && !quantityText) return
    if (!sku) {
      warnings.push(`${rowNumber}행: 사방넷 상품코드가 없어 제외했습니다.`)
      return
    }
    const quantity = quantityValue(row.getCell(quantityColumn))
    if (quantity === null) {
      warnings.push(`${rowNumber}행: 실 출고수량이 비어 있거나 올바른 정수가 아니어서 제외했습니다.`)
      return
    }
    const existing = items.get(sku)
    if (existing && !Number.isSafeInteger(existing.quantity + quantity)) {
      warnings.push(`${rowNumber}행: 상품의 출고수량 합계가 너무 커서 제외했습니다.`)
      return
    }
    if (!Number.isSafeInteger(totalQuantity + quantity)) {
      warnings.push(`${rowNumber}행: 전체 출고수량 합계가 너무 커서 제외했습니다.`)
      return
    }
    if (existing) {
      existing.quantity += quantity
      if (!existing.productName && productName) existing.productName = productName
      if (!existing.optionName && optionName) existing.optionName = optionName
    } else {
      items.set(sku, { sku, productName, optionName, quantity })
    }
    rowCount += 1
    totalQuantity += quantity
  })
  if (!rowCount) throw new Error('반영할 수 있는 주문 행이 없습니다. 상품코드와 실 출고수량을 확인해 주세요.')
  return { rowCount, productCount: items.size, totalQuantity, warnings, items: [...items.values()] }
}
