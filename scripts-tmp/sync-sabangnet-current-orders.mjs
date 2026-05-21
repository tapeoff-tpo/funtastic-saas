import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
import ExcelJS from 'exceljs'
import postgres from 'postgres'

const DEFAULT_FILE = '/Users/ian/Desktop/사방넷 주문건/0520까지 주문건.xlsx'
const DEFAULT_USER_ID = 'aad08ee7-a0dc-422f-8bb6-da243fe59b1b'
const BATCH_SIZE = 500

const apply = process.argv.includes('--apply')
const fileArgIndex = process.argv.indexOf('--file')
const sourceFile = fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : DEFAULT_FILE
const userId = process.env.MIGRATE_USER_ID ?? DEFAULT_USER_ID

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
  const yyyymmdd = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (yyyymmdd) return new Date(`${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}T00:00:00+09:00`)
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function stableHash(seed, length = 10) {
  return createHash('sha1').update(seed).digest('hex').slice(0, length)
}

function historicalMarketplaceId(row) {
  return `sabangnet-${stableHash(`${row.mallName}::${row.mallAccount}`)}`.slice(0, 50)
}

function randomInternalNo() {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

function normalizeName(value) {
  const normalized = value?.replace(/\s+/g, '').trim()
  return normalized ? normalized : null
}

function hasNameMatch(sourceNames, existing) {
  const incoming = sourceNames.map(normalizeName).filter(Boolean)
  const saved = [existing.buyer_name, existing.recipient_name].map(normalizeName).filter(Boolean)
  if (incoming.length === 0 || saved.length === 0) return true
  return incoming.some((name) => saved.includes(name))
}

function carrierFromName(name) {
  if (name.includes('CJ') || name.includes('대한통운')) return { id: 'CJGLS', name: 'CJ대한통운' }
  if (name.includes('경동')) return { id: 'KDEXP', name: '경동택배' }
  if (name.includes('대신')) return { id: 'DAESIN', name: '대신택배' }
  if (name.includes('한진')) return { id: 'HANJIN', name: '한진택배' }
  if (name.includes('롯데') || name.includes('현대')) return { id: 'HYUNDAI', name: '현대택배' }
  if (name.includes('우체국')) return { id: 'EPOST', name: '우체국택배' }
  if (name.includes('로젠')) return { id: 'KGB', name: '로젠택배' }
  return { id: 'ETC', name: name || '기타택배' }
}

function classifyStatus(statusRaw, trackingNumber) {
  const status = statusRaw ?? ''
  const isCancelRequest = status.includes('취소접수')
  const isClaimRequest = status.includes('반품') || status.includes('교환')

  if (isCancelRequest) {
    return {
      status: 'confirmed',
      isHeld: true,
      holdReason: '취소접수',
      logisticsMessage: null,
    }
  }

  if (status.includes('취소완료')) {
    return {
      status: 'cancelled',
      isHeld: false,
      holdReason: null,
      logisticsMessage: null,
    }
  }

  if (status.includes('출고완료') || status.includes('교환발송완료') || status.includes('교환완료')) {
    return {
      status: 'delivered',
      isHeld: false,
      holdReason: null,
      logisticsMessage: null,
    }
  }

  if (isClaimRequest) {
    return {
      status: status.includes('완료') ? 'cancelled' : 'confirmed',
      isHeld: false,
      holdReason: null,
      logisticsMessage: null,
    }
  }

  return {
    status: trackingNumber ? 'preparing' : 'new',
    isHeld: false,
    holdReason: null,
    logisticsMessage: null,
  }
}

async function readWorkbookRows(file) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []

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
    if (!marketplaceOrderId) continue

    const raw = {}
    for (let i = 1; i < headers.length; i += 1) {
      if (headers[i]) raw[headers[i]] = cellText(row.getCell(i).value)
    }

    const quantity = toNumber(get('실 출고수량')) || toNumber(get('주문수량')) || 1
    const unitPrice = toNumber(get('판매가'))
    const lineTotal = toNumber(get('최종결제금액')) || toNumber(get('판매가x수량')) || unitPrice * quantity
    const trackingNumber = get('송장번호')
    const statusRaw = get('주문상태')
    const shippedAtRaw = get('출고완료일자')

    rows.push({
      rowNumber,
      raw,
      sourceFile: path.basename(file),
      mallName: get('쇼핑몰명') || '사방넷',
      mallAccount: get('ID') || 'default',
      marketplaceProductCode: get('쇼핑몰 상품코드'),
      marketplaceOrderId,
      buyerName: get('주문자명'),
      collectedProductName: get('수집 상품명'),
      collectedOption: get('수집 옵션'),
      statusRaw,
      quantity,
      unitPrice,
      lineTotal,
      shippingFee: toNumber(get('배송비')),
      courier: get('택배사'),
      trackingNumber,
      collectedAt: parseKoreanDate(get('수집일자')),
      shippedAt: shippedAtRaw && shippedAtRaw !== '********' ? parseKoreanDate(shippedAtRaw) : null,
      sabangnetOrderNo: get('사방넷 주문번호'),
      sku: get('사방넷 상품코드'),
      productName: get('사방넷 상품명') || get('수집 상품명') || '미수집 상품',
      optionText: get('사방넷 옵션') || get('수집 옵션'),
      boxSize: get('택배박스 사이즈'),
    })
  }

  return rows
}

function buildGroups(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = `${historicalMarketplaceId(row)}::${row.marketplaceOrderId}`
    const group = groups.get(key) ?? {
      key,
      marketplaceId: historicalMarketplaceId(row),
      marketplaceOrderId: row.marketplaceOrderId,
      rows: [],
      sourceNames: new Set(),
    }
    group.rows.push(row)
    if (row.buyerName) group.sourceNames.add(row.buyerName)
    groups.set(key, group)
  }
  return Array.from(groups.values()).map((group) => {
    group.rows.sort((a, b) => (
      a.collectedAt.getTime() - b.collectedAt.getTime()
      || a.rowNumber - b.rowNumber
    ))
    const latest = group.rows[group.rows.length - 1]
    const trackingSource = [...group.rows].reverse().find((row) => row.trackingNumber) ?? latest
    const state = classifyStatus(latest.statusRaw, trackingSource.trackingNumber)
    return {
      ...group,
      first: group.rows[0],
      latest,
      trackingSource,
      state,
      totalAmount: group.rows.reduce((sum, row) => sum + row.lineTotal, 0),
      shippingFee: Math.max(...group.rows.map((row) => row.shippingFee), 0),
    }
  })
}

async function findExistingOrders(groups) {
  const orderNos = Array.from(new Set(groups.map((group) => group.marketplaceOrderId)))
  const existingByOrderNo = new Map()

  for (let i = 0; i < orderNos.length; i += BATCH_SIZE) {
    const batch = orderNos.slice(i, i + BATCH_SIZE)
    const rows = await sql`
      SELECT
        id::text,
        internal_no,
        marketplace_id,
        marketplace_order_id,
        status,
        is_held,
        buyer_name,
        recipient_name,
        raw_data
      FROM orders
      WHERE user_id = ${userId}
        AND marketplace_order_id = ANY(${batch})
      ORDER BY is_copy ASC, created_at ASC
    `

    for (const row of rows) {
      const current = existingByOrderNo.get(row.marketplace_order_id) ?? []
      current.push(row)
      existingByOrderNo.set(row.marketplace_order_id, current)
    }
  }

  const matches = new Map()
  const ambiguous = []
  for (const group of groups) {
    const candidates = existingByOrderNo.get(group.marketplaceOrderId) ?? []
    if (candidates.length === 0) continue

    const exact = candidates.find((row) => row.marketplace_id === group.marketplaceId)
    if (exact) {
      matches.set(group.key, exact)
      continue
    }

    const named = candidates.filter((row) => hasNameMatch([...group.sourceNames], row))
    if (named.length === 1) {
      matches.set(group.key, named[0])
    } else if (named.length > 1) {
      ambiguous.push({
        marketplaceOrderId: group.marketplaceOrderId,
        sourceNames: [...group.sourceNames],
        candidates: named.map((row) => ({
          id: row.id,
          internalNo: row.internal_no,
          marketplaceId: row.marketplace_id,
          buyerName: row.buyer_name,
          recipientName: row.recipient_name,
        })),
      })
    }
  }

  return { matches, ambiguous }
}

function orderInsertRows(group) {
  const now = new Date()
  return group.rows.map((row, index) => {
    const state = group.state
    return {
      id: randomUUID(),
      internal_no: randomInternalNo(),
      user_id: userId,
      connection_id: null,
      marketplace_id: group.marketplaceId,
      marketplace_order_id: group.marketplaceOrderId,
      status: state.status,
      previous_status: state.isHeld ? (state.status === 'new' ? 'confirmed' : state.status) : null,
      buyer_name: row.buyerName || '미수집',
      buyer_phone: null,
      buyer_phone2: null,
      recipient_name: row.buyerName || '미수집',
      recipient_phone: null,
      recipient_phone2: null,
      shipping_address: JSON.stringify({ zipCode: '', address1: '', address2: '' }),
      ordered_at: row.collectedAt,
      total_amount: row.lineTotal,
      is_held: state.isHeld,
      hold_reason: state.holdReason,
      held_at: state.isHeld ? now : null,
      raw_data: JSON.stringify({
        source: 'sabangnet-current-xlsx',
        mallName: row.mallName,
        mallAccount: row.mallAccount,
        originalStatus: row.statusRaw,
        sourceFile: row.sourceFile,
        rowNumber: row.rowNumber,
        sourceOrderKey: group.key,
        itemSplit: group.rows.length > 1 ? {
          splitAt: now.toISOString(),
          totalParts: group.rows.length,
          partIndex: index + 1,
          original: index === 0,
        } : undefined,
        sabangnetRaw: row.raw,
      }),
      marketplace_status: row.statusRaw,
      collected_at: row.collectedAt,
      logistics_message: state.logisticsMessage,
      shipping_type: group.shippingFee > 0 ? 'prepaid' : 'free',
      shipping_fee: row.shippingFee,
      is_copy: index > 0,
      delivery_message: null,
      created_at: row.collectedAt,
      updated_at: now,
    }
  })
}

function itemInsertRows(orderRows, group) {
  return orderRows.map((orderRow, index) => {
    const row = group.rows[index]
    return {
      id: randomUUID(),
      order_id: orderRow.id,
      marketplace_item_id: row.sabangnetOrderNo || row.marketplaceProductCode || `${row.marketplaceOrderId}-${index + 1}`,
      product_name: row.productName,
      option_text: row.optionText || null,
      quantity: row.quantity,
      unit_price: row.unitPrice || row.lineTotal / Math.max(row.quantity, 1),
      sku: row.sku || null,
      sku_multiplier: 1,
      fulfillment_code: 'normal',
    }
  })
}

function shipmentRow(orderId, group) {
  const row = group.trackingSource
  if (!row.trackingNumber) return null
  const carrier = carrierFromName(row.courier)
  return {
    id: randomUUID(),
    order_id: orderId,
    user_id: userId,
    tracking_number: row.trackingNumber,
    carrier_id: carrier.id,
    carrier_name: carrier.name,
    upload_status: 'confirmed',
    marketplace_upload_error: null,
    upload_attempts: 0,
    last_upload_at: row.shippedAt,
    shipped_at: row.shippedAt,
    created_at: new Date(),
    updated_at: new Date(),
  }
}

async function insertBatch(table, rows, columns) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    if (batch.length === 0) continue
    const result = table === 'orders'
      ? await sql`
          INSERT INTO orders ${sql(batch, columns)}
          ON CONFLICT (marketplace_id, marketplace_order_id)
          WHERE is_copy = false
          DO NOTHING
          RETURNING id
        `
      : table === 'order_items'
        ? await sql`
            INSERT INTO order_items ${sql(batch, columns)}
            ON CONFLICT DO NOTHING
            RETURNING id
          `
        : await sql`
            INSERT INTO shipments ${sql(batch, columns)}
            RETURNING id
          `
    inserted += result.length
  }
  return inserted
}

async function updateExistingOrder(existing, group) {
  const state = group.state
  const rawPatch = {
    sabangnetSync: {
      source: 'sabangnet-current-xlsx',
      syncedAt: new Date().toISOString(),
      sourceFile: group.latest.sourceFile,
      mallName: group.latest.mallName,
      mallAccount: group.latest.mallAccount,
      originalStatus: group.latest.statusRaw,
      latestRowNumber: group.latest.rowNumber,
      rows: group.rows.map((row) => ({
        rowNumber: row.rowNumber,
        sabangnetOrderNo: row.sabangnetOrderNo,
        status: row.statusRaw,
        trackingNumber: row.trackingNumber,
        courier: row.courier,
        boxSize: row.boxSize,
      })),
    },
  }
  await sql`
    UPDATE orders
    SET
      status = ${state.status},
      previous_status = CASE WHEN ${state.isHeld} THEN COALESCE(previous_status, status) ELSE previous_status END,
      is_held = ${state.isHeld},
      hold_reason = ${state.holdReason},
      held_at = CASE WHEN ${state.isHeld} THEN COALESCE(held_at, NOW()) ELSE held_at END,
      marketplace_status = ${group.latest.statusRaw},
      logistics_message = ${state.logisticsMessage},
      shipping_fee = ${group.shippingFee},
      raw_data = COALESCE(raw_data, '{}'::jsonb) || ${sql.json(rawPatch)},
      updated_at = NOW()
    WHERE id = ${existing.id}
      AND user_id = ${userId}
  `

  const shipment = shipmentRow(existing.id, group)
  if (shipment) {
    await sql`
      WITH current AS (
        SELECT id FROM shipments
        WHERE order_id = ${existing.id}
          AND user_id = ${userId}
        ORDER BY created_at ASC
        LIMIT 1
      )
      UPDATE shipments
      SET
        tracking_number = ${shipment.tracking_number},
        carrier_id = ${shipment.carrier_id},
        carrier_name = ${shipment.carrier_name},
        upload_status = ${shipment.upload_status},
        marketplace_upload_error = NULL,
        last_upload_at = ${shipment.last_upload_at},
        shipped_at = ${shipment.shipped_at},
        updated_at = NOW()
      WHERE id IN (SELECT id FROM current)
      RETURNING id
    `.then(async (updated) => {
      if (updated.length > 0) return
      await insertBatch('shipments', [shipment], SHIPMENT_COLUMNS)
    })
  }

  await sql`
    INSERT INTO order_change_logs (
      order_id, user_id, action, title, description, before, after, metadata, created_at
    )
    VALUES (
      ${existing.id},
      ${userId},
      'sabangnet.synced',
      '사방넷 주문 동기화',
      ${`사방넷 ${group.latest.statusRaw}${group.trackingSource.trackingNumber ? ` / ${group.trackingSource.trackingNumber}` : ''}`},
      ${sql.json({ status: existing.status, isHeld: existing.is_held })},
      ${sql.json({ status: state.status, isHeld: state.isHeld, trackingNumber: group.trackingSource.trackingNumber || null })},
      ${sql.json({ sourceFile: group.latest.sourceFile, rowNumbers: group.rows.map((row) => row.rowNumber) })},
      NOW()
    )
  `
}

const ORDER_COLUMNS = [
  'id',
  'internal_no',
  'user_id',
  'connection_id',
  'marketplace_id',
  'marketplace_order_id',
  'status',
  'previous_status',
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
  'hold_reason',
  'held_at',
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

const ITEM_COLUMNS = [
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

const SHIPMENT_COLUMNS = [
  'id',
  'order_id',
  'user_id',
  'tracking_number',
  'carrier_id',
  'carrier_name',
  'upload_status',
  'marketplace_upload_error',
  'upload_attempts',
  'last_upload_at',
  'shipped_at',
  'created_at',
  'updated_at',
]

async function main() {
  const rows = await readWorkbookRows(sourceFile)
  const groups = buildGroups(rows)
  const { matches, ambiguous } = await findExistingOrders(groups)

  const statusCounts = {}
  for (const group of groups) {
    statusCounts[group.latest.statusRaw] = (statusCounts[group.latest.statusRaw] ?? 0) + 1
  }

  const newGroups = groups.filter((group) => !matches.has(group.key) && !ambiguous.some((item) => item.marketplaceOrderId === group.marketplaceOrderId))
  const heldGroups = groups.filter((group) => group.state.isHeld)
  const shipmentGroups = groups.filter((group) => group.trackingSource.trackingNumber)

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY-RUN',
    sourceFile,
    userId,
    sourceRows: rows.length,
    sourceOrders: groups.length,
    matchedExistingOrders: matches.size,
    ambiguousOrders: ambiguous.length,
    newOrdersToCreate: newGroups.length,
    splitRowsToCreate: newGroups.reduce((sum, group) => sum + group.rows.length, 0),
    groupsWithTracking: shipmentGroups.length,
    heldOrders: heldGroups.length,
    statusCounts,
    ambiguous: ambiguous.slice(0, 20),
  }, null, 2))

  if (!apply) {
    console.log('Dry-run only. Re-run with --apply to write changes.')
    return
  }

  const insertedOrders = []
  const insertedItems = []
  const insertedShipments = []

  for (const [key, existing] of matches.entries()) {
    const group = groups.find((candidate) => candidate.key === key)
    if (group) await updateExistingOrder(existing, group)
  }

  for (const group of newGroups) {
    const ordersToInsert = orderInsertRows(group)
    const itemsToInsert = itemInsertRows(ordersToInsert, group)
    const shipmentsToInsert = ordersToInsert
      .map((orderRow) => shipmentRow(orderRow.id, group))
      .filter(Boolean)

    insertedOrders.push(...ordersToInsert)
    insertedItems.push(...itemsToInsert)
    insertedShipments.push(...shipmentsToInsert)
  }

  const insertedOrderCount = await insertBatch('orders', insertedOrders, ORDER_COLUMNS)
  const insertedItemCount = await insertBatch('order_items', insertedItems, ITEM_COLUMNS)
  const insertedShipmentCount = await insertBatch('shipments', insertedShipments, SHIPMENT_COLUMNS)

  if (insertedOrders.length > 0) {
    await sql`
      INSERT INTO order_change_logs (
        order_id, user_id, action, title, description, after, metadata, created_at
      )
      SELECT
        id,
        user_id,
        'sabangnet.imported',
        '사방넷 주문 가져오기',
        '사방넷 미연동 주문 신규 생성',
        jsonb_build_object('status', status, 'isHeld', is_held),
        jsonb_build_object('sourceFile', raw_data->>'sourceFile', 'rowNumber', raw_data->>'rowNumber'),
        NOW()
      FROM orders
      WHERE id = ANY(${insertedOrders.map((row) => row.id)})
    `
  }

  console.log(JSON.stringify({
    updatedExistingOrders: matches.size,
    insertedOrderRows: insertedOrderCount,
    insertedItemRows: insertedItemCount,
    insertedShipmentRows: insertedShipmentCount,
    ambiguousSkipped: ambiguous.length,
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
