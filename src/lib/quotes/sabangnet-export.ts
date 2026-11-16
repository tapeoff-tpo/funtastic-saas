import * as XLSX from 'xlsx'

/** The flat order-registration columns required by SabangNet. */
export const SABANGNET_HEADERS = [
  '주문번호',
  '수취인명',
  '주소',
  '전화번호',
  '배송메세지',
  '상품명',
  '옵션',
  '수량',
  '상품코드(상품명)',
] as const

export type SabangnetItem = {
  productCode?: string | null
  name?: string | null
  spec?: string | null
  qty?: number | string | null
}

/** Minimal shape accepted from a saved sales record. */
export type SabangnetSale = {
  clientName?: string | null
  recipientName?: string | null
  address?: string | null
  contactPhone?: string | null
  recipientPhone?: string | null
  deliveryMessage?: string | null
  items?: SabangnetItem[] | null
}

export type SabangnetRow = Record<(typeof SABANGNET_HEADERS)[number], string | number>

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const cleanText = (value: unknown) => String(value ?? '').trim()
const cleanOption = (value: unknown) => cleanText(value).toUpperCase() === 'EA' ? '' : cleanText(value)

function positiveNumber(value: unknown) {
  const number = Number(cleanText(value).replaceAll(',', ''))
  return Number.isFinite(number) && number > 0 ? number : null
}

function orderDateStamp(value: Date | string) {
  const direct = cleanText(value).match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/)
  if (direct) return `${direct[1]}${direct[2]}${direct[3]}`

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'ORDER'
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

function exportItems(sale: SabangnetSale): SabangnetItem[] {
  return (Array.isArray(sale.items) ? sale.items : []).filter((item) => (
    [item?.productCode, item?.name, item?.spec, item?.qty].some((value) => cleanText(value))
  ))
}

/** SabangNet identifies this operational order by the workbook generation date. */
export function sabangnetOrderNumberForSale(_sale: SabangnetSale = {}, generatedAt: Date | string = new Date()) {
  // The registration number is intentionally generation-date based, but the
  // sale parameter remains part of the stable call signature.
  void _sale
  return `${orderDateStamp(generatedAt)}-bob1`
}

/** Returns the exact fields that must be completed before a registration file can be created. */
export function sabangnetValidationIssues(sale: SabangnetSale = {}) {
  const issues: string[] = []
  if (!cleanText(sale.recipientName) && !cleanText(sale.clientName)) issues.push('수취인명')
  if (!cleanText(sale.address)) issues.push('주소')
  if (!cleanText(sale.recipientPhone) && !cleanText(sale.contactPhone)) issues.push('전화번호')

  const items = exportItems(sale)
  if (!items.length) return [...issues, '품목']
  if (items.some((item) => !cleanText(item.name))) issues.push('품명')
  if (items.some((item) => positiveNumber(item.qty) == null)) issues.push('수량')
  return [...new Set(issues)]
}

export function sabangnetRowsFromSale(sale: SabangnetSale = {}, generatedAt: Date | string = new Date()): SabangnetRow[] {
  const orderNumber = sabangnetOrderNumberForSale(sale, generatedAt)
  const recipientName = cleanText(sale.recipientName) || cleanText(sale.clientName)
  const address = cleanText(sale.address)
  const phone = cleanText(sale.recipientPhone) || cleanText(sale.contactPhone)
  const deliveryMessage = cleanText(sale.deliveryMessage)

  return exportItems(sale).map((item) => {
    const productName = cleanText(item.name)
    return {
      '주문번호': orderNumber,
      '수취인명': recipientName,
      '주소': address,
      '전화번호': phone,
      '배송메세지': deliveryMessage,
      '상품명': productName,
      '옵션': cleanOption(item.spec),
      '수량': positiveNumber(item.qty) ?? '',
      // The SabangNet registration sheet expects the product name copied here.
      '상품코드(상품명)': productName,
    }
  })
}

/**
 * Creates a browser-downloadable SabangNet registration workbook.
 * It deliberately validates first so a blank or malformed operational order is
 * never exported as a plausibly valid sheet.
 */
export function createSabangnetWorkbook(sale: SabangnetSale, generatedAt: Date | string = new Date()): ArrayBuffer {
  const issues = sabangnetValidationIssues(sale)
  if (issues.length) throw new Error(`사방넷 엑셀을 만들려면 ${issues.join(', ')}을(를) 입력해 주세요.`)

  const rows = sabangnetRowsFromSale(sale, generatedAt)
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...SABANGNET_HEADERS],
    ...rows.map((row) => SABANGNET_HEADERS.map((header) => row[header])),
  ])
  worksheet['!cols'] = [
    { wch: 22 }, { wch: 16 }, { wch: 42 }, { wch: 18 }, { wch: 28 },
    { wch: 30 }, { wch: 18 }, { wch: 10 }, { wch: 28 },
  ]
  worksheet['!autofilter'] = { ref: `A1:I${rows.length + 1}` }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array
  return bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).slice().buffer
}

export function sabangnetFilename(sale: SabangnetSale = {}, generatedAt: Date | string = new Date()) {
  return `사방넷_등록양식_${sabangnetOrderNumberForSale(sale, generatedAt)}.xlsx`
}

export { XLSX_MIME as sabangnetWorkbookMimeType }
