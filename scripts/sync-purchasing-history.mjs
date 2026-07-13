import path from 'node:path'
import ExcelJS from 'exceljs'
import postgres from 'postgres'

const STATUS_RANK = {
  requested: 0,
  purchased: 1,
  purchase_completed: 2,
  china_arrived: 3,
  outbound_requested: 4,
  completed: 5,
}

const BUYER_CODES = {
  '한상철': '1',
  '김기환': '2',
  '최종석': '3',
  '오지은': '4',
  '김소희': '5',
}

const DEFAULT_DIR = 'D:\\발주 saas'
const apply = process.argv.includes('--apply')
const includeCompleted = process.argv.includes('--include-completed')
const pendingArrivalOnly = process.argv.includes('--pending-arrival-only')
const sourceDir = flagValue('--dir') ?? DEFAULT_DIR
const since = flagValue('--since') ?? '2026-06-01'

if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  throw new Error('--since는 YYYY-MM-DD 형식으로 입력해주세요.')
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')

const sourceFiles = {
  request: path.join(sourceDir, '발주요청현황(발주요청).xlsx'),
  purchase: path.join(sourceDir, '발주계획현황(구매완료).xlsx'),
  arrival: path.join(sourceDir, '구매현황(중국창고도착).xlsx'),
  outbound: path.join(sourceDir, '견적서현황(중국출고요청).xlsx'),
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 30,
  connect_timeout: 30,
})

async function main() {
  try {
    const [requestRows, purchaseRows, arrivalRows, outboundRows] = await Promise.all([
      readSheet(sourceFiles.request, parseRequestRow),
      readSheet(sourceFiles.purchase, parsePurchaseRow),
      readSheet(sourceFiles.arrival, parseArrivalRow),
      readSheet(sourceFiles.outbound, parseOutboundRow),
    ])

    const ownerId = await findWorkspaceOwnerId()
    const productRows = await sql`
      SELECT internal_sku
      FROM products
      WHERE user_id = ${ownerId}
    `
    const productSkus = new Set(productRows.map((row) => row.internal_sku))
    const existingRows = await sql`
      SELECT *
      FROM purchase_request_items
      WHERE user_id = ${ownerId}
        AND purchase_management_code IS NOT NULL
    `
    const databaseStatusRows = await sql`
      SELECT status, COUNT(*)::int AS total
      FROM purchase_request_items
      WHERE user_id = ${ownerId}
      GROUP BY status
      ORDER BY status
    `
    const existingByKey = new Map(existingRows.map((row) => [
      managementSkuKey(row.purchase_management_code, row.sku),
      row,
    ]))

    const combined = combineStages({ requestRows, purchaseRows, arrivalRows, outboundRows })
    const latestRows = combined.rows.filter((row) => {
      if (!pendingArrivalOnly) return row.latestDate >= since
      return row.sourceRows.request !== null
        && row.requestDate >= since
        && (row.status === 'purchased' || row.status === 'purchase_completed')
    })
    const matchedRows = latestRows.filter((row) => productSkus.has(row.sku))
    const missingProductRows = latestRows.filter((row) => !productSkus.has(row.sku))
    const selectedRows = matchedRows.filter((row) => {
      if (row.status !== 'completed' || includeCompleted) return true
      return existingByKey.has(managementSkuKey(row.purchaseManagementCode, row.sku))
    })

    const [{ max_row_number: maxRowNumber }] = await sql`
      SELECT COALESCE(MAX(row_number), 0)::int AS max_row_number
      FROM purchase_request_items
      WHERE user_id = ${ownerId}
    `
    let nextRowNumber = maxRowNumber
    const now = new Date().toISOString()
    const payload = []
    let created = 0
    let updated = 0
    let unchanged = 0
    let preservedAdvancedStatus = 0
    const differenceSample = []

    for (const row of selectedRows) {
      const existing = existingByKey.get(managementSkuKey(row.purchaseManagementCode, row.sku))
      const nextStatus = existing && STATUS_RANK[existing.status] > STATUS_RANK[row.status]
        ? existing.status
        : row.status
      if (existing && nextStatus !== row.status) preservedAdvancedStatus += 1

      const values = toDatabaseRow({
        ownerId,
        row,
        existing,
        status: nextStatus,
        rowNumber: existing?.row_number ?? ++nextRowNumber,
        syncedAt: now,
      })
      if (existing && rowsEqual(existing, values)) {
        unchanged += 1
        continue
      }
      if (existing && differenceSample.length < 5) {
        differenceSample.push({
          purchaseManagementCode: row.purchaseManagementCode,
          sku: row.sku,
          differences: rowDifferences(existing, values),
        })
      }
      if (existing) updated += 1
      else created += 1
      payload.push(values)
    }

    const report = {
      mode: apply ? 'apply' : 'dry-run',
      since,
      includeCompleted,
      pendingArrivalOnly,
      sourceDir,
      sourceRows: {
        request: requestRows.length,
        purchase: purchaseRows.length,
        arrival: arrivalRows.length,
        outbound: outboundRows.length,
      },
      matching: {
        combined: combined.rows.length,
        ambiguousManagementCodes: combined.ambiguousManagementCodes.length,
        recentAmbiguousManagementCodes: combined.ambiguousManagementDetails
          .filter((row) => row.latestDate >= since).length,
        ambiguousOrderSkuKeys: combined.ambiguousOrderSkuKeys.length,
        reliableOutboundLinks: combined.reliableOutboundLinks,
        recentAmbiguousManagementSample: combined.ambiguousManagementDetails
          .filter((row) => row.latestDate >= since)
          .slice(0, 15),
      },
      recent: {
        total: latestRows.length,
        matchedProducts: matchedRows.length,
        missingProducts: missingProductRows.length,
        selected: selectedRows.length,
        statusCounts: countBy(selectedRows, (row) => row.status),
      },
      database: {
        statusCounts: Object.fromEntries(databaseStatusRows.map((row) => [row.status, row.total])),
        existingWithManagementCode: existingRows.length,
        created,
        updated,
        unchanged,
        preservedAdvancedStatus,
        differenceSample,
      },
      missingProductSample: missingProductRows.slice(0, 15).map(sampleRow),
      changeSample: payload.slice(0, 20).map((row) => ({
        purchaseManagementCode: row.purchase_management_code,
        sku: row.sku,
        status: row.status,
        requestDate: row.request_date,
        purchaseDate: row.outbound_expected_date,
        chinaArrivalDate: row.china_received_at?.slice(0, 10) ?? null,
        requestedQuantity: row.requested_quantity,
        actualPurchaseQuantity: row.actual_purchase_quantity,
      })),
    }
    console.log(JSON.stringify(report, null, 2))

    if (!apply) {
      console.log('\n읽기 전용 확인 완료. 실제 반영은 --apply를 추가하세요.')
      return
    }
    if (payload.length === 0) {
      console.log('\n반영할 변경이 없습니다.')
      return
    }

    const result = await applyPayload({ ownerId, payload, sourceDir, selectedRows, now })
    console.log('\n' + JSON.stringify({ applied: result.length, completedAt: new Date().toISOString() }, null, 2))
  } finally {
    await sql.end()
  }
}

async function readSheet(filePath, parser) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error(`시트를 찾을 수 없습니다: ${filePath}`)

  const headerRowNumber = findHeaderRow(sheet)
  const headers = new Map()
  sheet.getRow(headerRowNumber).eachCell((cell, column) => {
    headers.set(cellText(cell.value), column)
  })

  const rows = []
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const source = readRow(sheet.getRow(rowNumber), headers)
    const parsed = parser(source, rowNumber)
    if (parsed) rows.push(parsed)
  }
  return rows
}

function parseRequestRow(row, sourceRow) {
  const sku = normalizeSku(row['품목코드'])
  const purchaseManagementCode = text(row['구입관리코드'])
  const requestDate = parseStageDate(row['일자-No.'])
  if (!sku || !purchaseManagementCode || !requestDate) return null
  return {
    sourceRow,
    sku,
    purchaseManagementCode,
    requestDate,
    productName: text(row['품목명']),
    optionName: nullableText(row['규격']),
    requestedQuantity: nonNegativeInteger(row['구매수량(EA)']),
    buyerName: nullableText(row['사원(담당)명']),
    memo: nullableText(row['구매 참고사항']),
    unitPriceCny: numberOrNull(row['입고단가']),
    totalPriceCny: numberOrNull(row['총 구매가(위안화)']),
    totalPriceKrw: numberOrNull(row['총 구매가(원화)']),
  }
}

function parsePurchaseRow(row, sourceRow) {
  const sku = normalizeSku(row['품목코드'])
  const purchaseManagementCode = text(row['구입관리코드'])
  const purchaseDate = parseStageDate(row['일자-No.'])
  if (!sku || !purchaseManagementCode || !purchaseDate) return null
  return {
    sourceRow,
    sku,
    purchaseManagementCode,
    purchaseDate,
    productName: text(row['품목명']),
    optionName: nullableText(row['규격']),
    requestedQuantity: nonNegativeInteger(row['구매수량(EA)']),
    actualPurchaseQuantity: nonNegativeInteger(row['실 구매 수량(C)']),
    supplierOrderNumber: nullableText(row['주문서번호 (C)']),
    purchaseMethod: nullableText(row['구매진행여부 (C)']),
    purchaseUrl: nullableText(row.URL),
    unitPriceCny: numberOrNull(row['변경 단가 (C)']) ?? numberOrNull(row['단가']),
    shippingFeeCny: numberOrNull(row['변경 배송비 (C)']) ?? numberOrNull(row['배송비']),
    memo: nullableText(row['비고(실 필요수량)']),
  }
}

function parseArrivalRow(row, sourceRow) {
  const sku = normalizeSku(row['품목코드'])
  const purchaseManagementCode = text(row['구입관리코드'])
  const arrivalDate = parseStageDate(row['일자-No.'])
  if (!sku || !purchaseManagementCode || !arrivalDate) return null
  return {
    sourceRow,
    sku,
    purchaseManagementCode,
    arrivalDate,
    productName: text(row['품목명']),
    optionName: nullableText(row['규격']),
    chinaReceivedQuantity: nonNegativeInteger(row['구매수량(EA)']),
    supplierOrderNumber: nullableText(row['주문서번호 (C)']),
    unitPriceCny: numberOrNull(row['변경 단가(C)']) ?? numberOrNull(row['단가']),
    shippingFeeCny: numberOrNull(row['변경 배송비 (C)']) ?? numberOrNull(row['배송비']),
  }
}

function parseOutboundRow(row, sourceRow) {
  const sku = normalizeSku(row['품목코드'])
  const supplierOrderNumber = text(row['주문서번호'])
  const outboundDate = parseStageDate(row['일자-No.'])
  if (!sku || !supplierOrderNumber || !outboundDate) return null
  return {
    sourceRow,
    sku,
    supplierOrderNumber,
    outboundDate,
    outboundQuantity: nonNegativeInteger(row['낱개 출고 수량(C)'])
      ?? nonNegativeInteger(row['출고수량(EA)'])
      ?? 0,
    outboundManagementCode: nullableText(row['출고관리코드']),
  }
}

function combineStages({ requestRows, purchaseRows, arrivalRows, outboundRows }) {
  const managementSkuSets = new Map()
  const managementDates = new Map()
  for (const row of [...requestRows, ...purchaseRows, ...arrivalRows]) {
    const skus = managementSkuSets.get(row.purchaseManagementCode) ?? new Set()
    skus.add(row.sku)
    managementSkuSets.set(row.purchaseManagementCode, skus)
    const dates = managementDates.get(row.purchaseManagementCode) ?? []
    dates.push(row.requestDate ?? row.purchaseDate ?? row.arrivalDate)
    managementDates.set(row.purchaseManagementCode, dates)
  }
  const ambiguousManagementCodes = [...managementSkuSets.entries()]
    .filter(([, skus]) => skus.size > 1)
    .map(([code]) => code)
  const ambiguousManagementDetails = ambiguousManagementCodes.map((code) => ({
    purchaseManagementCode: code,
    skus: [...managementSkuSets.get(code)],
    latestDate: maxDate(managementDates.get(code).filter(Boolean)),
  }))

  const combinedByKey = new Map()
  for (const row of requestRows) mergeStage(combinedByKey, row, 'request')
  for (const row of purchaseRows) mergeStage(combinedByKey, row, 'purchase')
  for (const row of arrivalRows) mergeStage(combinedByKey, row, 'arrival')

  const managementRowsByOrderSku = new Map()
  for (const row of combinedByKey.values()) {
    const orderNumber = row.purchase?.supplierOrderNumber ?? row.arrival?.supplierOrderNumber
    if (!orderNumber) continue
    const orderSkuKey = `${orderNumber}|${row.sku}`
    const keys = managementRowsByOrderSku.get(orderSkuKey) ?? []
    keys.push(row)
    managementRowsByOrderSku.set(orderSkuKey, keys)
  }
  const ambiguousOrderSkuKeys = [...managementRowsByOrderSku.entries()]
    .filter(([, rows]) => rows.length !== 1)
    .map(([key]) => key)

  const outboundByOrderSku = groupBy(outboundRows, (row) => `${row.supplierOrderNumber}|${row.sku}`)
  let reliableOutboundLinks = 0
  for (const [orderSkuKey, stageRows] of managementRowsByOrderSku) {
    if (stageRows.length !== 1) continue
    const outboundMatches = outboundByOrderSku.get(orderSkuKey)
    if (!outboundMatches?.length) continue
    stageRows[0].outbound = outboundMatches
    reliableOutboundLinks += 1
  }

  const rows = [...combinedByKey.values()].map(finalizeCombinedRow)
  return {
    rows,
    ambiguousManagementCodes,
    ambiguousManagementDetails,
    ambiguousOrderSkuKeys,
    reliableOutboundLinks,
  }
}

function mergeStage(target, row, stage) {
  const key = managementSkuKey(row.purchaseManagementCode, row.sku)
  const current = target.get(key) ?? {
    sku: row.sku,
    purchaseManagementCode: row.purchaseManagementCode,
  }
  const currentStage = current[stage]
  const dateField = stage === 'request' ? 'requestDate' : stage === 'purchase' ? 'purchaseDate' : 'arrivalDate'
  if (!currentStage || row[dateField] >= currentStage[dateField]) current[stage] = row
  target.set(key, current)
}

function finalizeCombinedRow(row) {
  const request = row.request
  const purchase = row.purchase
  const arrival = row.arrival
  const outboundRows = row.outbound ?? []
  const outboundQuantity = outboundRows.reduce((total, item) => total + item.outboundQuantity, 0)
  const outboundDate = maxDate(outboundRows.map((item) => item.outboundDate))
  const expectedQuantity = arrival?.chinaReceivedQuantity
    ?? purchase?.actualPurchaseQuantity
    ?? purchase?.requestedQuantity
    ?? request?.requestedQuantity
    ?? 0
  let status = 'purchased'
  if (purchase) status = 'purchase_completed'
  if (arrival) status = 'china_arrived'
  if (outboundRows.length > 0) {
    status = expectedQuantity > 0 && outboundQuantity < expectedQuantity
      ? 'outbound_requested'
      : 'completed'
  }

  const latestDate = maxDate([
    request?.requestDate,
    purchase?.purchaseDate,
    arrival?.arrivalDate,
    outboundDate,
  ].filter(Boolean))

  return {
    sku: row.sku,
    purchaseManagementCode: row.purchaseManagementCode,
    status,
    latestDate,
    requestDate: request?.requestDate ?? purchase?.purchaseDate ?? arrival?.arrivalDate,
    purchaseDate: purchase?.purchaseDate ?? null,
    arrivalDate: arrival?.arrivalDate ?? null,
    outboundDate,
    productName: request?.productName || purchase?.productName || arrival?.productName || row.sku,
    optionName: request?.optionName ?? purchase?.optionName ?? arrival?.optionName ?? null,
    requestedQuantity: request?.requestedQuantity ?? purchase?.requestedQuantity ?? arrival?.chinaReceivedQuantity ?? 0,
    actualPurchaseQuantity: purchase?.actualPurchaseQuantity ?? purchase?.requestedQuantity ?? null,
    chinaReceivedQuantity: arrival?.chinaReceivedQuantity ?? null,
    outboundQuantity,
    supplierOrderNumber: purchase?.supplierOrderNumber ?? arrival?.supplierOrderNumber ?? null,
    purchaseMethod: purchase?.purchaseMethod ?? null,
    buyerName: request?.buyerName ?? null,
    memo: request?.memo ?? purchase?.memo ?? null,
    unitPriceCny: purchase?.unitPriceCny ?? arrival?.unitPriceCny ?? request?.unitPriceCny ?? null,
    totalPriceCny: request?.totalPriceCny ?? null,
    totalPriceKrw: request?.totalPriceKrw ?? null,
    shippingFeeCny: purchase?.shippingFeeCny ?? arrival?.shippingFeeCny ?? null,
    purchaseUrl: purchase?.purchaseUrl ?? null,
    sourceRows: {
      request: request?.sourceRow ?? null,
      purchase: purchase?.sourceRow ?? null,
      arrival: arrival?.sourceRow ?? null,
      outbound: outboundRows.map((item) => item.sourceRow),
    },
  }
}

function toDatabaseRow({ ownerId, row, existing, status, rowNumber, syncedAt }) {
  const existingRawData = isPlainObject(existing?.raw_data) ? existing.raw_data : {}
  const rawData = {
    ...existingRawData,
    source: existingRawData.source ?? 'ecount_purchase_history_sync',
    ecountPurchaseHistory: {
      requestDate: row.requestDate,
      purchaseDate: row.purchaseDate,
      chinaArrivalDate: row.arrivalDate,
      chinaOutboundDate: row.outboundDate,
      outboundQuantity: row.outboundQuantity,
      purchaseUrl: row.purchaseUrl,
      sourceRows: row.sourceRows,
      syncedAt,
    },
    outboundRequestedQuantity: row.outboundQuantity || existingRawData.outboundRequestedQuantity,
  }
  return {
    user_id: ownerId,
    row_number: rowNumber,
    status,
    request_date: row.requestDate,
    sku: row.sku,
    product_name: row.productName,
    option_name: row.optionName,
    requested_quantity: row.requestedQuantity,
    actual_purchase_quantity: row.actualPurchaseQuantity,
    purchase_management_code: row.purchaseManagementCode,
    supplier_order_number: row.supplierOrderNumber,
    outbound_expected_date: row.purchaseDate,
    purchase_method: row.purchaseMethod,
    buyer_code: BUYER_CODES[row.buyerName] ?? existing?.buyer_code ?? null,
    buyer_name: row.buyerName ?? existing?.buyer_name ?? null,
    memo: existing?.memo ?? row.memo,
    unit_price_cny: row.unitPriceCny,
    total_price_cny: row.totalPriceCny,
    total_price_krw: row.totalPriceKrw,
    shipping_fee_cny: row.shippingFeeCny,
    china_received_quantity: row.chinaReceivedQuantity,
    china_received_at: row.arrivalDate ? `${row.arrivalDate}T00:00:00+09:00` : null,
    raw_data: rawData,
    created_at: existing?.created_at?.toISOString?.() ?? `${row.requestDate}T00:00:00+09:00`,
    updated_at: `${row.latestDate}T23:59:59+09:00`,
  }
}

function rowsEqual(existing, next) {
  const scalarKeys = [
    'status', 'sku', 'product_name', 'option_name', 'requested_quantity',
    'actual_purchase_quantity', 'purchase_management_code', 'supplier_order_number',
    'purchase_method', 'buyer_code', 'buyer_name', 'memo',
    'china_received_quantity',
  ]
  const numericKeys = ['unit_price_cny', 'total_price_cny', 'total_price_krw', 'shipping_fee_cny']
  const dateKeys = ['request_date', 'outbound_expected_date', 'china_received_at']
  return scalarKeys.every((key) => comparable(existing[key]) === comparable(next[key]))
    && numericKeys.every((key) => numericComparable(existing[key]) === numericComparable(next[key]))
    && dateKeys.every((key) => dateOnly(existing[key]) === dateOnly(next[key]))
    && comparable(existing.raw_data?.ecountPurchaseHistory?.requestDate) === comparable(next.raw_data.ecountPurchaseHistory.requestDate)
    && comparable(existing.raw_data?.ecountPurchaseHistory?.purchaseDate) === comparable(next.raw_data.ecountPurchaseHistory.purchaseDate)
    && comparable(existing.raw_data?.ecountPurchaseHistory?.chinaArrivalDate) === comparable(next.raw_data.ecountPurchaseHistory.chinaArrivalDate)
    && comparable(existing.raw_data?.ecountPurchaseHistory?.chinaOutboundDate) === comparable(next.raw_data.ecountPurchaseHistory.chinaOutboundDate)
    && comparable(existing.raw_data?.ecountPurchaseHistory?.outboundQuantity) === comparable(next.raw_data.ecountPurchaseHistory.outboundQuantity)
}

function rowDifferences(existing, next) {
  const checks = {
    status: [existing.status, next.status],
    request_date: [dateOnly(existing.request_date), dateOnly(next.request_date)],
    sku: [existing.sku, next.sku],
    product_name: [existing.product_name, next.product_name],
    option_name: [existing.option_name, next.option_name],
    requested_quantity: [existing.requested_quantity, next.requested_quantity],
    actual_purchase_quantity: [existing.actual_purchase_quantity, next.actual_purchase_quantity],
    purchase_management_code: [existing.purchase_management_code, next.purchase_management_code],
    supplier_order_number: [existing.supplier_order_number, next.supplier_order_number],
    outbound_expected_date: [dateOnly(existing.outbound_expected_date), dateOnly(next.outbound_expected_date)],
    purchase_method: [existing.purchase_method, next.purchase_method],
    buyer_code: [existing.buyer_code, next.buyer_code],
    buyer_name: [existing.buyer_name, next.buyer_name],
    memo: [existing.memo, next.memo],
    unit_price_cny: [numericComparable(existing.unit_price_cny), numericComparable(next.unit_price_cny)],
    total_price_cny: [numericComparable(existing.total_price_cny), numericComparable(next.total_price_cny)],
    total_price_krw: [numericComparable(existing.total_price_krw), numericComparable(next.total_price_krw)],
    shipping_fee_cny: [numericComparable(existing.shipping_fee_cny), numericComparable(next.shipping_fee_cny)],
    china_received_quantity: [existing.china_received_quantity, next.china_received_quantity],
    china_received_at: [dateOnly(existing.china_received_at), dateOnly(next.china_received_at)],
    history_request_date: [existing.raw_data?.ecountPurchaseHistory?.requestDate, next.raw_data.ecountPurchaseHistory.requestDate],
    history_purchase_date: [existing.raw_data?.ecountPurchaseHistory?.purchaseDate, next.raw_data.ecountPurchaseHistory.purchaseDate],
    history_arrival_date: [existing.raw_data?.ecountPurchaseHistory?.chinaArrivalDate, next.raw_data.ecountPurchaseHistory.chinaArrivalDate],
    history_outbound_date: [existing.raw_data?.ecountPurchaseHistory?.chinaOutboundDate, next.raw_data.ecountPurchaseHistory.chinaOutboundDate],
    history_outbound_quantity: [existing.raw_data?.ecountPurchaseHistory?.outboundQuantity, next.raw_data.ecountPurchaseHistory.outboundQuantity],
  }
  return Object.fromEntries(Object.entries(checks).filter(([, [before, after]]) => {
    return comparable(before) !== comparable(after)
  }))
}

async function applyPayload({ ownerId, payload, sourceDir, selectedRows, now }) {
  return sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext(${'sync-purchasing-history:' + ownerId}))`
    await transaction`DROP INDEX IF EXISTS purchase_request_items_user_management_code`
    await transaction`
      CREATE UNIQUE INDEX IF NOT EXISTS purchase_request_items_user_management_code_sku
      ON purchase_request_items (user_id, purchase_management_code, sku)
    `
    const [batch] = await transaction`
      INSERT INTO purchase_request_batches (
        user_id, source_file_name, source_sheet_name, total_rows, imported_rows, skipped_rows
      ) VALUES (
        ${ownerId},
        ${`Ecount purchase history sync (${path.basename(sourceDir)})`},
        ${'발주요청→구매완료→중국창고도착→중국출고'},
        ${selectedRows.length},
        ${payload.length},
        ${selectedRows.length - payload.length}
      )
      RETURNING id
    `

    const appliedRows = []
    for (const group of chunks(payload, 250)) {
      const result = await transaction`
        INSERT INTO purchase_request_items (
          user_id, batch_id, row_number, status, request_date, sku, product_name, option_name,
          requested_quantity, actual_purchase_quantity, purchase_management_code,
          supplier_order_number, outbound_expected_date, purchase_method, buyer_code, buyer_name,
          memo, unit_price_cny, total_price_cny, total_price_krw, shipping_fee_cny,
          china_received_quantity, china_received_at, raw_data, created_at, updated_at
        )
        SELECT
          incoming.user_id::uuid,
          ${batch.id}::uuid,
          incoming.row_number,
          incoming.status::purchase_request_status,
          incoming.request_date::date,
          incoming.sku,
          incoming.product_name,
          incoming.option_name,
          incoming.requested_quantity,
          incoming.actual_purchase_quantity,
          incoming.purchase_management_code,
          incoming.supplier_order_number,
          incoming.outbound_expected_date::date,
          incoming.purchase_method,
          incoming.buyer_code,
          incoming.buyer_name,
          incoming.memo,
          incoming.unit_price_cny::numeric,
          incoming.total_price_cny::numeric,
          incoming.total_price_krw::numeric,
          incoming.shipping_fee_cny::numeric,
          incoming.china_received_quantity,
          incoming.china_received_at::timestamptz,
          incoming.raw_data,
          incoming.created_at::timestamptz,
          incoming.updated_at::timestamptz
        FROM jsonb_to_recordset(${transaction.json(group)}::jsonb) AS incoming(
          user_id text,
          row_number int,
          status text,
          request_date text,
          sku text,
          product_name text,
          option_name text,
          requested_quantity int,
          actual_purchase_quantity int,
          purchase_management_code text,
          supplier_order_number text,
          outbound_expected_date text,
          purchase_method text,
          buyer_code text,
          buyer_name text,
          memo text,
          unit_price_cny text,
          total_price_cny text,
          total_price_krw text,
          shipping_fee_cny text,
          china_received_quantity int,
          china_received_at text,
          raw_data jsonb,
          created_at text,
          updated_at text
        )
        ON CONFLICT (user_id, purchase_management_code, sku) DO UPDATE SET
          status = EXCLUDED.status,
          request_date = EXCLUDED.request_date,
          sku = EXCLUDED.sku,
          product_name = EXCLUDED.product_name,
          option_name = EXCLUDED.option_name,
          requested_quantity = EXCLUDED.requested_quantity,
          actual_purchase_quantity = EXCLUDED.actual_purchase_quantity,
          supplier_order_number = EXCLUDED.supplier_order_number,
          outbound_expected_date = EXCLUDED.outbound_expected_date,
          purchase_method = EXCLUDED.purchase_method,
          buyer_code = EXCLUDED.buyer_code,
          buyer_name = EXCLUDED.buyer_name,
          memo = EXCLUDED.memo,
          unit_price_cny = EXCLUDED.unit_price_cny,
          total_price_cny = EXCLUDED.total_price_cny,
          total_price_krw = EXCLUDED.total_price_krw,
          shipping_fee_cny = EXCLUDED.shipping_fee_cny,
          china_received_quantity = EXCLUDED.china_received_quantity,
          china_received_at = EXCLUDED.china_received_at,
          raw_data = EXCLUDED.raw_data,
          updated_at = EXCLUDED.updated_at
        RETURNING id, purchase_management_code, status
      `
      appliedRows.push(...result)
    }

    await transaction`
      UPDATE purchase_request_batches
      SET source_file_name = ${`Ecount purchase history sync ${since} (${now.slice(0, 10)})`}
      WHERE id = ${batch.id}
    `
    return appliedRows
  })
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
    sheet.getRow(rowNumber).eachCell((cell) => values.add(cellText(cell.value)))
    if (values.has('품목코드') && values.has('품목명')) return rowNumber
  }
  throw new Error(`${sheet.name} 시트의 헤더를 찾을 수 없습니다.`)
}

function readRow(row, headers) {
  return Object.fromEntries([...headers.entries()].map(([header, column]) => [
    header,
    cellValue(row.getCell(column).value),
  ]))
}

function cellValue(value) {
  if (value == null) return null
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    if ('result' in value) return cellValue(value.result)
    if ('text' in value) return value.text
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('')
    }
  }
  return value
}

function cellText(value) {
  return text(cellValue(value))
}

function parseStageDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const match = text(value).match(/(20\d{2})\D*(\d{2})\D*(\d{2})/)
  if (!match) return null
  const result = `${match[1]}-${match[2]}-${match[3]}`
  const parsed = new Date(`${result}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : result
}

function normalizeSku(value) {
  const result = text(value).replace(/\s+/g, '')
  return /^\d{6}-\d{4}$/.test(result) ? result : null
}

function text(value) {
  return value == null ? '' : String(value).trim()
}

function nullableText(value) {
  return text(value) || null
}

function numberOrNull(value) {
  if (value == null || text(value) === '') return null
  const parsed = Number(text(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function nonNegativeInteger(value) {
  const parsed = numberOrNull(value)
  return parsed != null && parsed >= 0 ? Math.trunc(parsed) : null
}

function maxDate(values) {
  return values.length > 0 ? [...values].sort().at(-1) : null
}

function groupBy(values, keySelector) {
  const result = new Map()
  for (const value of values) {
    const key = keySelector(value)
    const items = result.get(key) ?? []
    items.push(value)
    result.set(key, items)
  }
  return result
}

function managementSkuKey(purchaseManagementCode, sku) {
  return `${purchaseManagementCode}|${sku}`
}

function countBy(values, keySelector) {
  const result = {}
  for (const value of values) {
    const key = keySelector(value)
    result[key] = (result[key] ?? 0) + 1
  }
  return result
}

function sampleRow(row) {
  return {
    purchaseManagementCode: row.purchaseManagementCode,
    sku: row.sku,
    productName: row.productName,
    status: row.status,
    latestDate: row.latestDate,
  }
}

function comparable(value) {
  if (value == null) return ''
  return String(value)
}

function numericComparable(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dateOnly(value) {
  if (!value) return ''
  if (value instanceof Date) {
    return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  }
  return String(value).slice(0, 10)
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function chunks(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function flagValue(name) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
