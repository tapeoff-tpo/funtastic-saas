import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import postgres from 'postgres'

const file = '/Users/ian/Desktop/사방넷 주문건/0520까지 주문건.xlsx'
const userId = process.env.MIGRATE_USER_ID ?? 'aad08ee7-a0dc-422f-8bb6-da243fe59b1b'
const apply = process.argv.includes('--apply')
const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 20, connect_timeout: 20 })

function cellText(value) {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && 'text' in value) return String(value.text ?? '').trim()
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim()
  if (typeof value === 'object' && 'richText' in value) return value.richText.map((part) => part.text).join('').trim()
  return String(value).trim()
}

function toNumber(value) {
  const raw = cellText(value).replace(/,/g, '')
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

function randomInternalNo() {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

function normalizeName(value) {
  const normalized = value?.replace(/\s+/g, '').trim()
  return normalized ? normalized : null
}

function claimTypeFor(status) {
  if (status.startsWith('취소')) return 'cancel'
  if (status.startsWith('반품')) return 'return'
  if (status.startsWith('교환')) return 'exchange'
  return null
}

function orderStatusFor(status, trackingNumber) {
  if (status.includes('취소완료')) return 'cancelled'
  if (status.includes('출고완료') || status.includes('교환발송완료') || status.includes('교환완료')) return 'delivered'
  if (status.startsWith('취소접수')) return trackingNumber ? 'preparing' : 'confirmed'
  if (status.startsWith('반품') || status.startsWith('교환')) return trackingNumber ? 'preparing' : 'confirmed'
  return trackingNumber ? 'preparing' : 'new'
}

function isCopyStage(status) {
  return status.includes('회수준비') || status.includes('회수완료') || status.includes('교환발송준비') || status.includes('교환발송완료')
}

async function readRows() {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const sheet = workbook.worksheets[0]
  const headers = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = cellText(cell.value)
  })
  const col = (name) => headers.indexOf(name)
  const rows = []
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    const get = (name) => {
      const index = col(name)
      return index === -1 ? '' : cellText(row.getCell(index).value)
    }
    const marketplaceOrderId = get('주문번호(쇼핑몰)')
    const status = get('주문상태')
    if (!marketplaceOrderId || !status) continue
    rows.push({
      rowNumber,
      marketplaceOrderId,
      buyerName: get('주문자명'),
      mallName: get('쇼핑몰명') || '사방넷',
      mallAccount: get('ID') || 'default',
      marketplaceProductCode: get('쇼핑몰 상품코드'),
      sabangnetOrderNo: get('사방넷 주문번호'),
      sku: get('사방넷 상품코드'),
      productName: get('사방넷 상품명') || get('수집 상품명') || '미수집 상품',
      optionText: get('사방넷 옵션') || get('수집 옵션'),
      quantity: toNumber(get('실 출고수량')) || toNumber(get('주문수량')) || 1,
      unitPrice: toNumber(get('판매가')),
      totalAmount: toNumber(get('최종결제금액')) || toNumber(get('판매가x수량')),
      shippingFee: toNumber(get('배송비')),
      trackingNumber: get('송장번호'),
      collectedAt: parseKoreanDate(get('수집일자')),
      status,
      raw: Object.fromEntries(headers.slice(1).filter(Boolean).map((header) => [header, get(header)])),
    })
  }
  return rows
}

async function findBaseOrder(row) {
  const candidates = await sql`
    SELECT id::text, internal_no, marketplace_id, marketplace_order_id, buyer_name, recipient_name, status, is_copy, raw_data
    FROM orders
    WHERE user_id = ${userId}
      AND marketplace_order_id = ${row.marketplaceOrderId}
    ORDER BY is_copy ASC, created_at ASC
  `
  const bySabangnetNo = candidates.find((order) => {
    const raw = order.raw_data
    return raw && typeof raw === 'object' && raw.sabangnetRaw?.['사방넷 주문번호'] === row.sabangnetOrderNo
  })
  if (bySabangnetNo) return { order: bySabangnetNo, exactRow: true }

  const name = normalizeName(row.buyerName)
  const named = candidates.filter((order) => {
    if (!name) return true
    return [order.buyer_name, order.recipient_name].map(normalizeName).includes(name)
  })
  if (named.length === 0) return { order: null, exactRow: false }
  return { order: named.find((order) => !order.is_copy) ?? named[0], exactRow: false }
}

async function insertClaim(orderId, row, originalOrderId = null) {
  const claimType = claimTypeFor(row.status)
  if (!claimType) return false
  const marketplaceClaimId = `sabangnet-${claimType}-${row.sabangnetOrderNo || row.marketplaceOrderId}-${orderId}`.slice(0, 200)
  await sql`
    INSERT INTO claims (
      id, order_id, user_id, marketplace_id, marketplace_claim_id, claim_type, claim_status,
      reason, raw_data, requested_at, created_at, updated_at
    )
    SELECT
      ${randomUUID()},
      ${orderId},
      ${userId},
      o.marketplace_id,
      ${marketplaceClaimId},
      ${claimType},
      ${row.status.includes('완료') ? 'completed' : row.status.includes('준비') ? 'processing' : 'requested'},
      ${row.status},
      ${sql.json({
        source: 'sabangnet-current-reclassify',
        originalOrderId,
        sabangnetOrderNo: row.sabangnetOrderNo,
        rowNumber: row.rowNumber,
        raw: row.raw,
      })},
      ${row.collectedAt},
      NOW(),
      NOW()
    FROM orders o
    WHERE o.id = ${orderId}
    ON CONFLICT (marketplace_id, marketplace_claim_id)
    DO UPDATE SET
      claim_status = EXCLUDED.claim_status,
      reason = EXCLUDED.reason,
      raw_data = EXCLUDED.raw_data,
      updated_at = NOW()
  `
  return true
}

async function copyFromBase(base, row) {
  const [created] = await sql`
    INSERT INTO orders (
      id, internal_no, user_id, connection_id, marketplace_id, marketplace_order_id, status, previous_status,
      buyer_name, buyer_phone, buyer_phone2, recipient_name, recipient_phone, recipient_phone2,
      shipping_address, ordered_at, total_amount, is_held, hold_reason, held_at,
      logistics_message, delivery_message, raw_data, marketplace_status, collected_at,
      shipping_type, shipping_fee, is_copy, created_at, updated_at
    )
    SELECT
      ${randomUUID()},
      ${randomInternalNo()},
      user_id,
      connection_id,
      marketplace_id,
      marketplace_order_id,
      ${orderStatusFor(row.status, row.trackingNumber)},
      NULL,
      buyer_name,
      buyer_phone,
      buyer_phone2,
      recipient_name,
      recipient_phone,
      recipient_phone2,
      shipping_address,
      ordered_at,
      ${row.totalAmount || 0},
      FALSE,
      NULL,
      NULL,
      NULL,
      delivery_message,
      ${sql.json({
        source: 'sabangnet-current-xlsx',
        sabangnetReclassifiedCopy: true,
        originalOrderId: base.id,
        mallName: row.mallName,
        mallAccount: row.mallAccount,
        rowNumber: row.rowNumber,
        sabangnetRaw: row.raw,
      })},
      ${row.status},
      ${row.collectedAt},
      shipping_type,
      ${row.shippingFee},
      TRUE,
      NOW(),
      NOW()
    FROM orders
    WHERE id = ${base.id}
    RETURNING id::text
  `
  if (!created) return null

  await sql`
    INSERT INTO order_items (
      id, order_id, marketplace_item_id, product_name, option_text, quantity, unit_price, sku, sku_multiplier, fulfillment_code
    )
    VALUES (
      ${randomUUID()},
      ${created.id},
      ${row.sabangnetOrderNo || row.marketplaceProductCode || `${row.marketplaceOrderId}-${row.rowNumber}`},
      ${row.productName},
      ${row.optionText || null},
      ${row.quantity},
      ${row.unitPrice || row.totalAmount || 0},
      ${row.sku || null},
      1,
      'normal'
    )
  `
  return created.id
}

async function main() {
  const rows = await readRows()
  const claimRows = rows.filter((row) => claimTypeFor(row.status))
  let updatedOrders = 0
  let insertedCopyOrders = 0
  let upsertedClaims = 0
  let skipped = 0

  const sourceOrders = await sql`
    SELECT id::text, marketplace_status
    FROM orders
    WHERE user_id = ${userId}
      AND (
        raw_data->>'source' = 'sabangnet-current-xlsx'
        OR raw_data ? 'sabangnetSync'
      )
  `

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY-RUN',
    file,
    sourceRows: rows.length,
    claimRows: claimRows.length,
    sabangnetOrdersInDb: sourceOrders.length,
  }, null, 2))

  if (!apply) return

  await sql`
    UPDATE orders
    SET
      logistics_message = NULL,
      is_held = CASE
        WHEN COALESCE(raw_data->'sabangnetRaw'->>'주문상태', raw_data->'sabangnetSync'->>'originalStatus', marketplace_status, '') LIKE '취소접수%'
        THEN TRUE ELSE FALSE END,
      hold_reason = CASE
        WHEN COALESCE(raw_data->'sabangnetRaw'->>'주문상태', raw_data->'sabangnetSync'->>'originalStatus', marketplace_status, '') LIKE '취소접수%'
        THEN '취소접수' ELSE NULL END,
      held_at = CASE
        WHEN COALESCE(raw_data->'sabangnetRaw'->>'주문상태', raw_data->'sabangnetSync'->>'originalStatus', marketplace_status, '') LIKE '취소접수%'
        THEN COALESCE(held_at, NOW()) ELSE NULL END,
      updated_at = NOW()
    WHERE user_id = ${userId}
      AND (
        raw_data->>'source' = 'sabangnet-current-xlsx'
        OR raw_data ? 'sabangnetSync'
        OR logistics_message LIKE '사방넷%'
      )
  `

  for (const row of claimRows) {
    const { order: base, exactRow } = await findBaseOrder(row)
    if (!base) {
      skipped += 1
      continue
    }

    let targetOrderId = exactRow ? base.id : null
    if (!targetOrderId && isCopyStage(row.status)) {
      const existingCopy = await sql`
        SELECT id::text
        FROM orders
        WHERE user_id = ${userId}
          AND raw_data->'sabangnetRaw'->>'사방넷 주문번호' = ${row.sabangnetOrderNo}
        LIMIT 1
      `
      targetOrderId = existingCopy[0]?.id ?? await copyFromBase(base, row)
      if (targetOrderId && !existingCopy[0]?.id) insertedCopyOrders += 1
    }
    if (!targetOrderId) targetOrderId = base.id

    const isHeld = row.status.startsWith('취소접수')
    await sql`
      UPDATE orders
      SET
        marketplace_status = ${row.status},
        status = ${orderStatusFor(row.status, row.trackingNumber)},
        is_held = ${isHeld},
        hold_reason = ${isHeld ? '취소접수' : null},
        held_at = CASE WHEN ${isHeld} THEN COALESCE(held_at, NOW()) ELSE NULL END,
        logistics_message = NULL,
        raw_data = COALESCE(raw_data, '{}'::jsonb) || ${sql.json({
          sabangnetReclassifiedAt: new Date().toISOString(),
          sabangnetStatus: row.status,
          sabangnetOrderNo: row.sabangnetOrderNo,
        })},
        updated_at = NOW()
      WHERE id = ${targetOrderId}
        AND user_id = ${userId}
    `
    updatedOrders += 1
    if (await insertClaim(targetOrderId, row, targetOrderId === base.id ? null : base.id)) upsertedClaims += 1

    if ((row.status === '반품접수' || row.status === '교환접수') && targetOrderId !== base.id) {
      await insertClaim(base.id, row, null)
    }
  }

  const [heldNonCancel] = await sql`
    SELECT COUNT(*)::int AS count
    FROM orders
    WHERE user_id = ${userId}
      AND is_held = TRUE
      AND COALESCE(marketplace_status, '') NOT LIKE '취소접수%'
  `

  const [sabangnetMessages] = await sql`
    SELECT COUNT(*)::int AS count
    FROM orders
    WHERE user_id = ${userId}
      AND logistics_message LIKE '사방넷%'
  `

  console.log(JSON.stringify({
    updatedOrders,
    insertedCopyOrders,
    upsertedClaims,
    skipped,
    heldNonCancel: heldNonCancel.count,
    sabangnetLogisticsMessages: sabangnetMessages.count,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await sql.end()
  })
