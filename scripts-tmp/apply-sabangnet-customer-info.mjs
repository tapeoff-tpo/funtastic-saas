import ExcelJS from 'exceljs'
import postgres from 'postgres'

const apply = process.argv.includes('--apply')
const files = [
  '/private/tmp/sabangnet_customer_2026_01_02.xlsx',
  '/private/tmp/sabangnet_customer_2026_03_04.xlsx',
]

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

function normalizePhone(value) {
  return String(value ?? '').trim()
}

function infoScore(info) {
  return [
    info.recipientName,
    info.recipientPhone,
    info.recipientPhone2,
    info.address,
  ].filter(Boolean).join('').length
}

async function readCustomerInfoRows() {
  const byOrderNo = new Map()
  const stats = {
    rows: 0,
    withOrderNo: 0,
    withRecipientInfo: 0,
    duplicateOrderRows: 0,
  }

  for (const file of files) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(file)

    for (const sheet of workbook.worksheets) {
      const headers = []
      sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
        headers[col] = cellText(cell.value)
      })
      const col = (name) => headers.indexOf(name)
      const columns = {
        recipientName: col('받는분성명'),
        recipientPhone: col('받는분전화번호'),
        recipientPhone2: col('받는분기타연락처'),
        address: col('받는분주소(전체? 분할)'),
        marketplaceOrderId: col('쇼핑몰 주문번호'),
        deliveryMessage: col('배송메세지'),
      }

      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
        stats.rows++
        const row = sheet.getRow(rowNumber)
        const get = (index) => (index > 0 ? cellText(row.getCell(index).value) : '')
        const marketplaceOrderId = get(columns.marketplaceOrderId)
        if (!marketplaceOrderId) continue
        stats.withOrderNo++

        const info = {
          marketplaceOrderId,
          recipientName: get(columns.recipientName),
          recipientPhone: normalizePhone(get(columns.recipientPhone)),
          recipientPhone2: normalizePhone(get(columns.recipientPhone2)),
          address: get(columns.address),
          deliveryMessage: get(columns.deliveryMessage),
          sourceFile: file,
          rowNumber,
        }
        if (infoScore(info) > 0) stats.withRecipientInfo++

        const existing = byOrderNo.get(marketplaceOrderId)
        if (existing) stats.duplicateOrderRows++
        if (!existing || infoScore(info) > infoScore(existing)) {
          byOrderNo.set(marketplaceOrderId, info)
        }
      }
    }
  }

  return { rows: [...byOrderNo.values()], stats }
}

function buildShippingAddress(address) {
  return {
    zipCode: '',
    address1: address,
    address2: '',
  }
}

async function main() {
  const { rows, stats } = await readCustomerInfoRows()
  const orderNos = rows.map((row) => row.marketplaceOrderId)
  const existing = orderNos.length > 0
    ? await sql`
        SELECT
          id::text,
          marketplace_order_id,
          buyer_name,
          recipient_name,
          recipient_phone,
          recipient_phone2
        FROM orders
        WHERE raw_data->>'source' = 'sabangnet-history-xlsx'
          AND marketplace_order_id IN ${sql(orderNos)}
      `
    : []

  const existingByOrderNo = new Map(existing.map((order) => [order.marketplace_order_id, order]))
  const updates = rows
    .filter((row) => existingByOrderNo.has(row.marketplaceOrderId))
    .filter((row) => infoScore(row) > 0)
    .map((row) => ({
      ...row,
      order: existingByOrderNo.get(row.marketplaceOrderId),
    }))

  const matchedOrderNos = new Set(existing.map((order) => order.marketplace_order_id))
  const unmatched = rows
    .filter((row) => !matchedOrderNos.has(row.marketplaceOrderId))
    .map((row) => row.marketplaceOrderId)

  const summary = {
    mode: apply ? 'APPLY' : 'DRY_RUN',
    fileStats: stats,
    uniqueOrderNumbers: rows.length,
    matchedHistoricalOrders: existing.length,
    usefulMatchedRows: updates.length,
    unmatchedOrderNumbers: unmatched.length,
    unmatchedSample: unmatched.slice(0, 20),
    sampleUpdates: updates.slice(0, 5).map((row) => ({
      marketplaceOrderId: row.marketplaceOrderId,
      recipientName: row.recipientName,
      recipientPhone: row.recipientPhone,
      recipientPhone2: row.recipientPhone2,
      address: row.address,
      currentBuyerName: row.order.buyer_name,
      currentRecipientName: row.order.recipient_name,
    })),
  }
  console.log(JSON.stringify(summary, null, 2))

  if (!apply) return

  let updated = 0
  await sql.begin(async (tx) => {
    await tx`
      CREATE TEMP TABLE tmp_sabangnet_customer_info (
        marketplace_order_id text PRIMARY KEY,
        recipient_name text,
        recipient_phone text,
        recipient_phone2 text,
        address text,
        delivery_message text,
        source_file text,
        row_number int
      ) ON COMMIT DROP
    `

    const rowsForTemp = updates.map((row) => ({
      marketplace_order_id: row.marketplaceOrderId,
      recipient_name: row.recipientName || null,
      recipient_phone: row.recipientPhone || null,
      recipient_phone2: row.recipientPhone2 || null,
      address: row.address || null,
      delivery_message: row.deliveryMessage || null,
      source_file: row.sourceFile,
      row_number: row.rowNumber,
    }))

    for (let i = 0; i < rowsForTemp.length; i += 5000) {
      const batch = rowsForTemp.slice(i, i + 5000)
      await tx`
        INSERT INTO tmp_sabangnet_customer_info ${tx(
          batch,
          'marketplace_order_id',
          'recipient_name',
          'recipient_phone',
          'recipient_phone2',
          'address',
          'delivery_message',
          'source_file',
          'row_number',
        )}
        ON CONFLICT (marketplace_order_id) DO UPDATE SET
          recipient_name = excluded.recipient_name,
          recipient_phone = excluded.recipient_phone,
          recipient_phone2 = excluded.recipient_phone2,
          address = excluded.address,
          delivery_message = excluded.delivery_message,
          source_file = excluded.source_file,
          row_number = excluded.row_number
      `
      console.log(`temp rows ${Math.min(i + batch.length, rowsForTemp.length)}/${rowsForTemp.length}`)
    }

    const result = await tx`
      UPDATE orders o
      SET
        buyer_name = CASE
          WHEN (o.buyer_name IS NULL OR o.buyer_name = '' OR o.buyer_name = '미수집')
            THEN COALESCE(NULLIF(t.recipient_name, ''), o.buyer_name)
          ELSE o.buyer_name
        END,
        recipient_name = COALESCE(NULLIF(t.recipient_name, ''), o.recipient_name),
        recipient_phone = COALESCE(NULLIF(t.recipient_phone, ''), o.recipient_phone),
        recipient_phone2 = COALESCE(
          NULLIF(t.recipient_phone2, ''),
          NULLIF(t.recipient_phone, ''),
          o.recipient_phone2
        ),
        shipping_address = CASE
          WHEN t.address IS NOT NULL AND t.address <> ''
            THEN jsonb_build_object('zipCode', '', 'address1', t.address, 'address2', '')
          ELSE o.shipping_address
        END,
        delivery_message = COALESCE(NULLIF(t.delivery_message, ''), o.delivery_message),
        raw_data = jsonb_set(
          o.raw_data,
          '{customerInfoSource}',
          jsonb_build_object(
            'source', 'sabangnet-customer-info-xlsx',
            'sourceFile', t.source_file,
            'rowNumber', t.row_number
          ),
          true
        ),
        updated_at = now()
      FROM tmp_sabangnet_customer_info t
      WHERE o.raw_data->>'source' = 'sabangnet-history-xlsx'
        AND o.marketplace_order_id = t.marketplace_order_id
    `
    updated = result.count
  })

  const verify = await sql`
    SELECT
      COUNT(*)::int AS updated_customer_info,
      COUNT(*) FILTER (
        WHERE recipient_name IS NOT NULL
          AND recipient_name <> ''
          AND recipient_name <> '미수집'
      )::int AS has_recipient_name,
      COUNT(*) FILTER (
        WHERE recipient_phone IS NOT NULL
          AND recipient_phone <> ''
          OR recipient_phone2 IS NOT NULL
          AND recipient_phone2 <> ''
      )::int AS has_recipient_phone,
      COUNT(*) FILTER (
        WHERE shipping_address->>'address1' IS NOT NULL
          AND shipping_address->>'address1' <> ''
      )::int AS has_address
    FROM orders
    WHERE raw_data->>'source' = 'sabangnet-history-xlsx'
      AND raw_data ? 'customerInfoSource'
  `

  console.log(JSON.stringify({ updated, verify: verify[0] }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => sql.end())
