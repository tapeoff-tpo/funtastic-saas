import { randomUUID, createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import postgres from 'postgres'

const SHEET_NAME = '20260502_주문서확인처리_BM,PM 매출확인용 양식'
const BATCH_SIZE = 1000
const apply = process.argv.includes('--apply')

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 20,
})

function cellText(value) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && 'text' in value) return String(value.text ?? '').trim()
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim()
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('').trim()
  }
  return String(value).trim()
}

function toNumber(value) {
  const raw = cellText(value).replace(/,/g, '')
  if (!raw || raw === '********') return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseKoreanDate(value) {
  const raw = cellText(value)
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`)
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function normalizedStatus(raw) {
  if (raw.includes('취소') || raw.includes('반품')) return 'cancelled'
  if (raw.includes('출고완료') || raw.includes('교환완료') || raw.includes('교환발송완료')) return 'delivered'
  if (raw.includes('출고') || raw.includes('발송')) return 'shipped'
  return 'new'
}

function stableHash(seed, length = 10) {
  return createHash('sha1').update(seed).digest('hex').slice(0, length)
}

function internalNo(seed) {
  return stableHash(seed, 8)
}

function historicalMarketplaceId(row) {
  return `sabangnet-${stableHash(`${row.mallName}::${row.mallAccount}`)}`.slice(0, 50)
}

async function findOrderFiles() {
  const desktop = '/Users/ian/Desktop'
  const dirs = await readdir(desktop, { withFileTypes: true })
  const orderDir = dirs.find((entry) =>
    entry.isDirectory() && entry.name.normalize('NFC').includes('사방넷 주문건')
  )
  if (!orderDir) return []

  const dir = path.join(desktop, orderDir.name)
  const entries = await readdir(dir)
  return entries
    .filter((name) => name.endsWith('.xlsx') && name.normalize('NFC').includes('주문'))
    .sort()
    .map((name) => path.join(dir, name))
}

async function readWorkbookRows(file) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.worksheets[0]
  if (!sheet) return []

  const headers = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellText(cell.value)
  })
  const col = (name) => headers.indexOf(name)
  const rows = []

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    const get = (name) => {
      const index = col(name)
      return index === -1 ? '' : cellText(row.getCell(index).value)
    }

    const marketplaceOrderId = get('주문번호(쇼핑몰)')
    if (!marketplaceOrderId) continue

    const raw = {}
    for (let i = 1; i < headers.length; i++) {
      if (headers[i]) raw[headers[i]] = cellText(row.getCell(i).value)
    }

    const mallName = get('쇼핑몰명') || '사방넷'
    const mallAccount = get('ID') || 'default'
    const quantity = toNumber(get('실 출고수량')) || toNumber(get('주문수량')) || 1
    const unitPrice = toNumber(get('판매가'))
    const lineTotal = toNumber(get('최종결제금액')) || toNumber(get('판매가x수량')) || unitPrice * quantity
    const shippingFee = toNumber(get('배송비'))
    const collectedAt = parseKoreanDate(get('수집일자'))
    const shippedAtRaw = get('출고완료일자')

    rows.push({
      sourceFile: path.basename(file),
      rowNumber,
      raw,
      mallName,
      mallAccount,
      statusRaw: get('주문상태'),
      marketplaceOrderId,
      marketplaceProductCode: get('쇼핑몰 상품코드'),
      buyerName: get('주문자명') || '미수집',
      collectedProductName: get('수집 상품명'),
      collectedOption: get('수집 옵션'),
      quantity,
      shippingFee,
      unitPrice,
      lineTotal,
      courier: get('택배사'),
      trackingNumber: get('송장번호'),
      collectedAt,
      shippedAt: shippedAtRaw === '********' || !shippedAtRaw ? null : parseKoreanDate(shippedAtRaw),
      sabangnetOrderNo: get('사방넷 주문번호'),
      sku: get('사방넷 상품코드'),
      productName: get('사방넷 상품명') || get('수집 상품명') || '미수집 상품',
      optionText: get('사방넷 옵션') || get('수집 옵션'),
      boxSize: get('택배박스 사이즈'),
    })
  }

  return rows
}

async function resolveUserId() {
  if (process.env.MIGRATE_USER_ID) return process.env.MIGRATE_USER_ID

  const users = await sql`
    SELECT user_id::text AS user_id
    FROM orders
    GROUP BY user_id
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `
  if (users[0]?.user_id) return users[0].user_id

  const connections = await sql`
    SELECT user_id::text AS user_id
    FROM marketplace_connections
    GROUP BY user_id
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `
  if (connections[0]?.user_id) return connections[0].user_id

  throw new Error('MIGRATE_USER_ID is required.')
}

function buildRows(sourceRows, userId) {
  const grouped = new Map()
  for (const row of sourceRows) {
    const key = `${historicalMarketplaceId(row)}::${row.marketplaceOrderId}`
    const group = grouped.get(key)
    if (group) group.items.push(row)
    else grouped.set(key, { first: row, items: [row] })
  }

  const orders = []
  const items = []

  for (const [key, group] of grouped) {
    const first = group.first
    const orderId = randomUUID()
    const marketplaceId = historicalMarketplaceId(first)
    const totalAmount = group.items.reduce((sum, item) => sum + item.lineTotal, 0)
    const shippingFee = Math.max(...group.items.map((item) => item.shippingFee), 0)
    const orderedAt = first.collectedAt

    orders.push({
      id: orderId,
      internal_no: internalNo(key),
      user_id: userId,
      connection_id: null,
      marketplace_id: marketplaceId,
      marketplace_order_id: first.marketplaceOrderId,
      status: normalizedStatus(first.statusRaw),
      buyer_name: first.buyerName,
      buyer_phone: null,
      buyer_phone2: null,
      recipient_name: first.buyerName,
      recipient_phone: null,
      recipient_phone2: null,
      shipping_address: JSON.stringify({ zipCode: '', address1: '', address2: '' }),
      ordered_at: orderedAt,
      total_amount: totalAmount,
      is_held: false,
      raw_data: JSON.stringify({
        source: 'sabangnet-history-xlsx',
        mallName: first.mallName,
        mallAccount: first.mallAccount,
        originalStatus: first.statusRaw,
        sourceFiles: [...new Set(group.items.map((item) => item.sourceFile))],
        note: '수취인 전화/주소는 이 원본 엑셀에 포함되어 있지 않음',
        rows: group.items.map((item) => ({
          sourceFile: item.sourceFile,
          rowNumber: item.rowNumber,
          raw: item.raw,
        })),
      }),
      marketplace_status: first.statusRaw,
      collected_at: first.collectedAt,
      logistics_message: null,
      shipping_type: shippingFee > 0 ? 'prepaid' : 'free',
      shipping_fee: shippingFee,
      is_copy: false,
      delivery_message: null,
      created_at: orderedAt,
      updated_at: new Date(),
    })

    for (const [index, item] of group.items.entries()) {
      items.push({
        id: randomUUID(),
        order_id: orderId,
        marketplace_item_id: item.marketplaceProductCode || `${item.sabangnetOrderNo || item.marketplaceOrderId}-${index + 1}`,
        product_name: item.productName,
        option_text: item.optionText || null,
        quantity: item.quantity,
        unit_price: item.unitPrice || item.lineTotal / Math.max(item.quantity, 1),
        sku: item.sku || null,
        sku_multiplier: 1,
        fulfillment_code: 'normal',
      })
    }
  }

  return { orders, items }
}

async function insertInBatches(table, rows, columns) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const result = table === 'orders'
      ? await sql`
          INSERT INTO orders ${sql(batch, columns)}
          ON CONFLICT (marketplace_id, marketplace_order_id)
          WHERE is_copy = false
          DO NOTHING
          RETURNING id
        `
      : await sql`
          INSERT INTO order_items ${sql(batch, columns)}
          ON CONFLICT DO NOTHING
          RETURNING id
        `
    inserted += result.length
    console.log(`${table}: ${Math.min(i + batch.length, rows.length)}/${rows.length}`)
  }
  return inserted
}

async function main() {
  const files = await findOrderFiles()
  if (files.length === 0) throw new Error('사방넷 주문 엑셀 파일을 찾지 못했습니다.')

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
  const sourceRows = []
  for (const file of files) {
    const rows = await readWorkbookRows(file)
    sourceRows.push(...rows)
    console.log(`${path.basename(file)}: ${rows.length} rows`)
  }

  const userId = await resolveUserId()
  const { orders, items } = buildRows(sourceRows, userId)

  const statusCounts = new Map()
  for (const order of orders) {
    statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1)
  }

  console.log(JSON.stringify({
    targetUserId: userId,
    sourceRows: sourceRows.length,
    historicalOrders: orders.length,
    orderItems: items.length,
    statusCounts: Object.fromEntries(statusCounts),
  }, null, 2))

  if (!apply) {
    console.log('Dry-run only. Re-run with --apply to insert.')
    return
  }

  const orderColumns = [
    'id',
    'internal_no',
    'user_id',
    'connection_id',
    'marketplace_id',
    'marketplace_order_id',
    'status',
    'buyer_name',
    'buyer_phone',
    'buyer_phone2',
    'recipient_name',
    'recipient_phone',
    'recipient_phone2',
    'shipping_address',
    'ordered_at',
    'total_amount',
    'is_held',
    'raw_data',
    'marketplace_status',
    'collected_at',
    'logistics_message',
    'shipping_type',
    'shipping_fee',
    'is_copy',
    'delivery_message',
    'created_at',
    'updated_at',
  ]
  const itemColumns = [
    'id',
    'order_id',
    'marketplace_item_id',
    'product_name',
    'option_text',
    'quantity',
    'unit_price',
    'sku',
    'sku_multiplier',
    'fulfillment_code',
  ]

  const insertedOrders = await insertInBatches('orders', orders, orderColumns)
  await sql`
    UPDATE orders
    SET
      raw_data = CASE WHEN jsonb_typeof(raw_data) = 'string' THEN (raw_data #>> '{}')::jsonb ELSE raw_data END,
      shipping_address = CASE WHEN jsonb_typeof(shipping_address) = 'string' THEN (shipping_address #>> '{}')::jsonb ELSE shipping_address END
    WHERE user_id = ${userId}
      AND marketplace_id LIKE 'sabangnet-%'
  `

  const existing = await sql`
    SELECT id::text, marketplace_id, marketplace_order_id
    FROM orders
    WHERE user_id = ${userId}
      AND marketplace_id LIKE 'sabangnet-%'
  `
  const orderIdByKey = new Map(existing.map((order) => [`${order.marketplace_id}::${order.marketplace_order_id}`, order.id]))
  const sourceOrderById = new Map(orders.map((order) => [order.id, order]))
  const remappedItems = items
    .map((item) => {
      const order = sourceOrderById.get(item.order_id)
      if (!order) return null
      const orderId = orderIdByKey.get(`${order.marketplace_id}::${order.marketplace_order_id}`)
      return orderId ? { ...item, order_id: orderId } : null
    })
    .filter(Boolean)

  const insertedItems = await insertInBatches('order_items', remappedItems, itemColumns)
  console.log(JSON.stringify({ insertedOrders, insertedItems }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await sql.end()
  })
