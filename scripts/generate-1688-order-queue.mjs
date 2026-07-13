import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import postgres from 'postgres'

const DEFAULT_DIR = 'D:\\발주 saas\\URL 크롤링'
const sourceDir = flagValue('--dir') ?? DEFAULT_DIR
const outputPath = flagValue('--output') ?? path.join(sourceDir, 'order-queue.json')

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')

const sources = [
  { key: 'purchase', file: '발주계획현황(구매완료).xlsx' },
  { key: 'arrival', file: '구매현황(중국창고도착).xlsx' },
  { key: 'outbound', file: '견적서현황(중국출고요청).xlsx' },
  { key: 'request', file: '발주요청현황(발주요청).xlsx', noteOnly: true },
]

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 30,
  connect_timeout: 30,
})

try {
  const ownerId = await findWorkspaceOwnerId()
  const productRows = await sql`
    SELECT internal_sku
    FROM products
    WHERE user_id = ${ownerId}
      AND NULLIF(BTRIM(COALESCE(metadata->'esa009m'->>'구매 URL', '')), '') IS NULL
  `
  const missingUrlSkus = new Set(productRows.map((row) => String(row.internal_sku).trim()))
  const ordersByNumber = new Map()
  let sourceRows = 0
  let extractedPairs = 0

  for (const source of sources) {
    const filePath = path.join(sourceDir, source.file)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePath)
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error(`시트를 찾을 수 없습니다: ${source.file}`)

    const headerRowNumber = findHeaderRow(sheet)
    const headers = new Map()
    sheet.getRow(headerRowNumber).eachCell((cell, column) => {
      const header = cell.text.trim()
      if (header) headers.set(header, column)
    })
    const skuColumn = headers.get('품목코드')
    const dateColumn = headers.get('일자-No.')
    const noteColumn = headers.get('구매 참고사항')
    const orderColumns = source.noteOnly
      ? []
      : [...headers.entries()]
          .filter(([header]) => header.replace(/\s+/g, '').startsWith('주문서번호'))
          .map(([, column]) => column)

    if (!skuColumn) throw new Error(`${source.file}: 품목코드 열을 찾을 수 없습니다.`)
    if (source.noteOnly && !noteColumn) {
      throw new Error(`${source.file}: 구매 참고사항 열을 찾을 수 없습니다.`)
    }

    for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber)
      const sku = normalizeSku(row.getCell(skuColumn).text)
      if (!sku) continue
      sourceRows += 1
      const sourceDate = dateColumn ? stageDate(row.getCell(dateColumn).text) : ''

      const orderNumbers = source.noteOnly
        ? extractNotedOrderNumbers(row.getCell(noteColumn).text)
        : orderColumns.flatMap((column) => extractOrderNumbers(row.getCell(column).text))

      for (const orderNumber of new Set(orderNumbers)) {
        const current = ordersByNumber.get(orderNumber) ?? {
          orderNumber,
          skus: new Set(),
          sources: new Set(),
          latestDate: '',
        }
        current.skus.add(sku)
        current.sources.add(source.key)
        if (sourceDate > current.latestDate) current.latestDate = sourceDate
        ordersByNumber.set(orderNumber, current)
        extractedPairs += 1
      }
    }
  }

  const orders = [...ordersByNumber.values()]
    .sort((left, right) => (
      right.latestDate.localeCompare(left.latestDate)
      || right.orderNumber.localeCompare(left.orderNumber)
    ))
    .flatMap((order) => {
      const skus = [...order.skus].filter((sku) => missingUrlSkus.has(sku)).sort()
      return skus.length > 0
        ? [{
            orderNumber: order.orderNumber,
            items: skus.map((sku) => ({ sku })),
            sources: [...order.sources],
          }]
        : []
    })
  const queueId = `excel-${createHash('sha256')
    .update(JSON.stringify(orders.map(({ orderNumber, items }) => ({ orderNumber, items }))))
    .digest('hex')
    .slice(0, 20)}`
  const payload = {
    version: 1,
    queueId,
    generatedAt: new Date().toISOString(),
    sourceFiles: sources.map((source) => source.file),
    stats: {
      sourceRows,
      extractedOrders: ordersByNumber.size,
      extractedPairs,
      missingUrlProducts: missingUrlSkus.size,
      queuedOrders: orders.length,
      queuedItems: orders.reduce((sum, order) => sum + order.items.length, 0),
    },
    orders,
  }

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ outputPath, queueId, ...payload.stats }, null, 2))
} finally {
  await sql.end()
}

async function findWorkspaceOwnerId() {
  const adminOwner = await sql`
    SELECT id
    FROM user_profiles
    WHERE deactivated_at IS NULL
      AND (email ILIKE 'admin123%' OR display_name ILIKE 'admin123%')
    ORDER BY created_at ASC
    LIMIT 1
  `
  if (adminOwner[0]?.id) return adminOwner[0].id

  const productOwner = await sql`
    SELECT user_id AS id
    FROM products
    ORDER BY created_at ASC
    LIMIT 1
  `
  if (productOwner[0]?.id) return productOwner[0].id
  throw new Error('공유 데이터 소유자를 찾을 수 없습니다.')
}

function findHeaderRow(sheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(20, sheet.rowCount); rowNumber += 1) {
    const values = new Set()
    sheet.getRow(rowNumber).eachCell((cell) => values.add(cell.text.trim()))
    if (values.has('품목코드') && values.has('품목명')) return rowNumber
  }
  throw new Error(`${sheet.name} 시트의 헤더를 찾을 수 없습니다.`)
}

function extractOrderNumbers(value) {
  const digitRuns = String(value || '').match(/\d{10,}/g) ?? []
  return digitRuns.flatMap((run) => {
    if (run.length >= 38 && run.length % 19 === 0) {
      return Array.from(
        { length: run.length / 19 },
        (_, index) => run.slice(index * 19, (index + 1) * 19),
      )
    }
    return run.length <= 40 ? [run] : []
  })
}

function extractNotedOrderNumbers(value) {
  const result = []
  const pattern = /1688\s*주문번호\s*[:：]?\s*(\d{10,40})/gi
  for (const match of String(value || '').matchAll(pattern)) {
    result.push(...extractOrderNumbers(match[1]))
  }
  return result
}

function normalizeSku(value) {
  const result = String(value || '').replace(/\s+/g, '')
  return /^\d{6}-\d{4}$/.test(result) ? result : null
}

function stageDate(value) {
  return String(value || '').trim().match(/^(\d{8})/)?.[1] ?? ''
}

function flagValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}
