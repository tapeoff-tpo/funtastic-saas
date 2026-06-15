import ExcelJS from 'exceljs'
import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'

export const ESA009M_HEADERS = [
  '품목코드',
  '품목명',
  '규격정보',
  '한국창고기준 위치',
  '영문명',
  '검역대상 여부',
  '100KG 인증여부',
  'HS CODE',
  '재질',
  '기존원가(元)',
  '신규원가(元)',
  '상품원가(元)',
  '배송비(元)',
  'works 기존 원가',
  'works 신규 원가',
  '품목구분',
  '매입부가세',
  '보통영수증 (%)',
  '증취세영수증  (%)',
] as const

export type Esa009mHeader = (typeof ESA009M_HEADERS)[number]
export type Esa009mData = Record<Esa009mHeader, string | null>

export async function getPurchasingItems(input: {
  userId: string
  page: number
  pageSize: number
  search?: string
}) {
  const conditions = [
    eq(products.userId, input.userId),
    sql`${products.metadata}->'esa009m' IS NOT NULL`,
  ]
  if (input.search) {
    const pattern = `%${input.search}%`
    conditions.push(or(
      ilike(products.internalSku, pattern),
      ilike(products.name, pattern),
      sql`${products.metadata}->'esa009m'->>'영문명' ILIKE ${pattern}`,
      sql`${products.metadata}->'esa009m'->>'HS CODE' ILIKE ${pattern}`,
    )!)
  }
  const where = and(...conditions)
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: products.id,
      metadata: products.metadata,
      updatedAt: products.updatedAt,
    }).from(products).where(where).orderBy(asc(products.internalSku))
      .limit(input.pageSize).offset((input.page - 1) * input.pageSize),
    db.select({ total: count() }).from(products).where(where),
  ])

  return {
    items: rows.map((row) => ({
      id: row.id,
      data: normalizeEsaData(row.metadata?.esa009m),
      updatedAt: row.updatedAt,
    })),
    total,
  }
}

export async function importPurchasingItems(input: { userId: string; fileBuffer: ArrayBuffer }) {
  const parsed = await parseEsa009mWorkbook(input.fileBuffer)
  for (const chunk of chunks(parsed.rows, 250)) {
    await db.insert(products).values(chunk.map((row) => ({
      userId: input.userId,
      internalSku: row['품목코드']!,
      name: row['품목명'] || row['품목코드']!,
      basePrice: '0',
      costPrice: numericText(row['works 신규 원가'] || row['works 기존 원가']),
      warehouseLocation: row['한국창고기준 위치'],
      status: 'active' as const,
      metadata: { esa009m: row },
    }))).onConflictDoUpdate({
      target: [products.userId, products.internalSku],
      set: {
        metadata: sql`COALESCE(${products.metadata}, '{}'::jsonb) || excluded.metadata`,
        updatedAt: sql`NOW()`,
      },
    })
  }
  return { total: parsed.total, imported: parsed.rows.length, skipped: parsed.skipped }
}

export async function parseEsa009mWorkbook(fileBuffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(fileBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('엑셀 시트를 찾을 수 없습니다.')

  const headerRow = findHeaderRow(sheet)
  if (!headerRow) throw new Error('ESA009M 품목코드/품목명 헤더를 찾을 수 없습니다.')
  const columnByHeader = new Map<string, number>()
  sheet.getRow(headerRow).eachCell((cell, column) => columnByHeader.set(cellText(cell.value), column))
  const missing = ESA009M_HEADERS.filter((header) => !columnByHeader.has(header))
  if (missing.length > 0) throw new Error(`필수 열이 없습니다: ${missing.join(', ')}`)

  const rows: Esa009mData[] = []
  let total = 0
  let skipped = 0
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return
    const data = Object.fromEntries(ESA009M_HEADERS.map((header) => {
      const value = cellText(row.getCell(columnByHeader.get(header)!).value)
      return [header, value || null]
    })) as Esa009mData
    if (!Object.values(data).some(Boolean)) return
    total += 1
    if (!data['품목코드'] || !data['품목명']) {
      skipped += 1
      return
    }
    rows.push(data)
  })
  return { rows, total, skipped }
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const values = new Set<string>()
    sheet.getRow(rowNumber).eachCell((cell) => values.add(cellText(cell.value)))
    if (values.has('품목코드') && values.has('품목명')) return rowNumber
  }
  return null
}

function normalizeEsaData(value: unknown): Esa009mData {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(ESA009M_HEADERS.map((header) => [
    header,
    source[header] == null ? null : String(source[header]),
  ])) as Esa009mData
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim()
  }
  return String(value).trim()
}

function numericText(value: string | null): string | null {
  if (!value) return null
  const number = Number(value.replace(/,/g, ''))
  return Number.isFinite(number) ? String(number) : null
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
