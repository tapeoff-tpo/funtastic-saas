import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { marketplaceConnections, products, productVariants } from '@/lib/db/schema'
import { adjustStockInTransaction } from '@/lib/inventory/actions'
import { parseOrderExcel, type ParsedOrderRow } from '@/lib/orders/excel-import'
import { normalizeExcelWorkbookBuffer } from '@/lib/orders/excel-workbook-buffer'
import type { OrderImportMapping } from '@/lib/orders/excel-import-fields'
import { parseImportedOrderedAt } from '@/lib/orders/import-date'
import { alignSabangnetRawRows, matchMarketplaceConnection } from '@/lib/analytics/sabangnet-review'

export type OutboundReflectionStatus = 'ready' | 'blocked' | 'applied' | 'excluded'
export type OutboundClaimType = 'cancel' | 'return' | 'exchange' | null

export type OutboundReflectionIssueCode =
  | 'duplicate_in_file'
  | 'already_reflected'
  | 'legacy_order_exists'
  | 'sku_unmatched'
  | 'quantity_invalid'

export type OutboundReflectionBatch = {
  id: string
  sourceFileName: string
  applyInventory: boolean
  totalRows: number
  readyRows: number
  blockedRows: number
  appliedRows: number
  excludedRows: number
  totalQuantity: number
  totalSales: number
  createdAt: Date
  appliedAt: Date | null
}

export type OutboundReflectionLine = {
  id: string
  batchId: string
  rowNumber: number
  sourceOrderNumber: string
  shipmentDate: string
  marketplaceName: string | null
  marketplaceId: string | null
  sku: string | null
  productName: string | null
  optionText: string | null
  quantity: number
  salesAmount: number
  shippingFee: number | null
  marketplaceFee: number | null
  profitAmount: number | null
  claimType: OutboundClaimType
  reflectionStatus: OutboundReflectionStatus
  issueCodes: OutboundReflectionIssueCode[]
  issueMessages: string[]
  appliedAt: Date | null
  createdAt: Date
}

export type OutboundReflectionLinePatch = {
  sku?: string
  productName?: string
  optionText?: string
  quantity?: number
  salesAmount?: number
}

export type OutboundReflectionSalesAggregate = {
  marketplaceId: string
  marketplaceName: string
  sales: number
  productCost: number
  marketplaceFee: number
  paidShippingFee: number
  actualShippingFee: number
  boxCost: number
  finalProfit: number
  hasProfitData: boolean
}

type RawExcelRow = Record<string, string>

const ORDER_STATUS_HEADERS = ['주문상태', '상태', 'CS상태', '클레임상태', '처리상태']
const MARKETPLACE_HEADERS = ['쇼핑몰명', '마켓명', '쇼핑몰', '마켓', '사이트명', '판매처']
const SABANGNET_ORDER_NUMBER_HEADERS = ['사방넷 주문번호', '사방넷주문번호']
const SABANGNET_SKU_HEADERS = ['사방넷 상품코드', '사방넷상품코드']
const SHIPMENT_DATE_HEADERS = ['출고완료일자', '출고완료 날짜', '출고일자', '출고일']
const MARKETPLACE_FEE_HEADERS = ['결제금액 수수료', '판매수수료', '수수료']
const PROFIT_HEADERS = ['순이익액', '순이익', '이익금액']
const SALES_TOTAL_HEADERS = ['판매가x수량', '판매가×수량']

// 품목 화면과 매출분석이 같은 Works 원가를 사용하도록 고정한다.
// p 별칭은 출고반영 집계 CTE의 products 조인에서 사용한다.
const OUTBOUND_ITEM_COST = sql`
  NULLIF(
    regexp_replace(
      COALESCE(
        NULLIF(p.metadata->'esa009m'->>'works 신규 원가', ''),
        NULLIF(p.metadata->'esa009m'->>'works 기존 원가', ''),
        ''
      ),
      '[^0-9.-]',
      '',
      'g'
    ),
    ''
  )::numeric
`

const TABLE_SQL = sql`
  CREATE TABLE IF NOT EXISTS outbound_reflection_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    source_file_name varchar(255) NOT NULL,
    file_hash varchar(64) NOT NULL,
    apply_inventory boolean NOT NULL DEFAULT true,
    total_rows integer NOT NULL DEFAULT 0,
    ready_rows integer NOT NULL DEFAULT 0,
    blocked_rows integer NOT NULL DEFAULT 0,
    applied_rows integer NOT NULL DEFAULT 0,
    excluded_rows integer NOT NULL DEFAULT 0,
    total_quantity integer NOT NULL DEFAULT 0,
    total_sales numeric(16, 4) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    applied_at timestamptz,
    UNIQUE (user_id, file_hash)
  );

  CREATE TABLE IF NOT EXISTS outbound_reflection_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES outbound_reflection_batches(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    row_number integer NOT NULL,
    source_key varchar(500) NOT NULL,
    source_order_number varchar(200) NOT NULL,
    shipment_date date NOT NULL,
    marketplace_name text,
    marketplace_id varchar(50),
    sku varchar(100),
    product_name text,
    option_text text,
    quantity integer NOT NULL DEFAULT 0,
    sales_amount numeric(16, 4) NOT NULL DEFAULT 0,
    shipping_fee numeric(16, 4),
    marketplace_fee numeric(16, 4),
    profit_amount numeric(16, 4),
    claim_type varchar(30),
    reflection_status varchar(30) NOT NULL DEFAULT 'blocked',
    issue_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    issue_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    applied_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (batch_id, row_number)
  );

  CREATE INDEX IF NOT EXISTS outbound_reflection_batches_user_created_idx
    ON outbound_reflection_batches(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS outbound_reflection_lines_user_batch_status_idx
    ON outbound_reflection_lines(user_id, batch_id, reflection_status, row_number);
  CREATE INDEX IF NOT EXISTS outbound_reflection_lines_user_date_idx
    ON outbound_reflection_lines(user_id, shipment_date, reflection_status);
  CREATE UNIQUE INDEX IF NOT EXISTS outbound_reflection_applied_source_key_idx
    ON outbound_reflection_lines(user_id, source_key)
    WHERE reflection_status = 'applied';
`

let ensureTablesPromise: Promise<void> | null = null

export function ensureOutboundReflectionTables() {
  if (!ensureTablesPromise) {
    ensureTablesPromise = db.execute(sql`
      SELECT EXISTS(
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'outbound_reflection_batches'
      ) AS "exists"
    `)
      .then((result) => Boolean(resultRows<{ exists: boolean }>(result)[0]?.exists))
      .then((exists) => exists ? undefined : db.execute(TABLE_SQL).then(async () => {
        await db.execute(sql`ALTER TABLE outbound_reflection_batches ENABLE ROW LEVEL SECURITY`)
        await db.execute(sql`ALTER TABLE outbound_reflection_lines ENABLE ROW LEVEL SECURITY`)
      }))
      .then(() => undefined)
      .catch((error) => {
        ensureTablesPromise = null
        throw error
      })
  }
  return ensureTablesPromise
}

export async function importOutboundReflectionBatch(input: {
  userId: string
  fileName: string
  fileBuffer: ArrayBuffer
  mappings?: OrderImportMapping[]
  fallbackMarketplaceId?: string
  fallbackMarketplaceName?: string
  applyInventory?: boolean
}) {
  const buffer = normalizeExcelWorkbookBuffer(Buffer.from(input.fileBuffer))
  await ensureOutboundReflectionTables()

  const fileHash = createHash('sha256').update(buffer).digest('hex')
  const [existingBatch] = resultRows<{ id: string }>(await db.execute(sql`
    SELECT id
    FROM outbound_reflection_batches
    WHERE user_id = ${input.userId}::uuid
      AND file_hash = ${fileHash}
    LIMIT 1
  `))
  if (existingBatch) {
    return { batchId: existingBatch.id, skipped: true, totalRows: 0, readyRows: 0, blockedRows: 0, errors: [] }
  }

  const [parseResult, rawRows] = await Promise.all([
    parseOrderExcel(buffer, input.mappings),
    parseRawRows(buffer),
  ])
  const rawRowAlignment = alignSabangnetRawRows(parseResult.rows, rawRows)
  const errors = [
    ...parseResult.errors,
    ...rawRowAlignment.unmatchedParsedRowNumbers.map((row) => ({
      row,
      message: '주문번호와 상품코드로 원본 사방넷 행을 찾지 못했습니다.',
    })),
  ]
  if (parseResult.rows.length === 0) {
    return { batchId: null, skipped: false, totalRows: 0, readyRows: 0, blockedRows: 0, errors }
  }

  const [connections, productSkuRows, variantSkuRows, appliedKeys, legacyKeys] = await Promise.all([
    db.select({
      id: marketplaceConnections.id,
      marketplaceId: marketplaceConnections.marketplaceId,
      displayName: marketplaceConnections.displayName,
      metadata: marketplaceConnections.metadata,
    })
      .from(marketplaceConnections)
      .where(sql`${marketplaceConnections.userId} = ${input.userId}`),
    db.select({ sku: products.internalSku })
      .from(products)
      .where(sql`${products.userId} = ${input.userId} AND ${products.status} <> 'deleted'`),
    db.select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, sql`${products.id} = ${productVariants.productId}`)
      .where(sql`${products.userId} = ${input.userId} AND ${products.status} <> 'deleted' AND ${productVariants.isActive} = true`),
    getAppliedSourceKeys(input.userId),
    getLegacyConfirmedSourceKeys(input.userId),
  ])

  const skuSet = new Set([
    ...productSkuRows.map((row) => row.sku).filter(Boolean),
    ...variantSkuRows.map((row) => row.sku).filter(Boolean),
  ])

  const pendingLines = parseResult.rows.map((row, index) => {
    const raw = rawRowAlignment.rows[index] ?? {}
    const rawMarketplaceName = pickByHeaders(raw, MARKETPLACE_HEADERS)
    const marketplaceName = rawMarketplaceName || input.fallbackMarketplaceName || input.fallbackMarketplaceId || ''
    const connection = matchMarketplaceConnection(connections, marketplaceName, input.fallbackMarketplaceId)
    const reportingMarketplace = normalizeOutboundReflectionMarketplace(
      marketplaceName,
      connection?.marketplaceId ?? input.fallbackMarketplaceId ?? null,
    )
    const sourceOrderNumber = pickByHeaders(raw, SABANGNET_ORDER_NUMBER_HEADERS) || row.orderNumber
    const sourceSku = pickByHeaders(raw, SABANGNET_SKU_HEADERS) || row.sku || ''
    return {
      row,
      raw,
      rowNumber: index + 1,
      sourceOrderNumber,
      sourceKey: createSourceKey(sourceOrderNumber, sourceSku || row.sku || `row-${index + 1}`),
      shipmentDate: formatShipmentDate(pickByHeaders(raw, SHIPMENT_DATE_HEADERS) || row.orderedAt),
      marketplaceName: reportingMarketplace.name ?? '',
      marketplaceId: reportingMarketplace.id,
    }
  })

  const sourceKeyCounts = new Map<string, number>()
  for (const line of pendingLines) {
    sourceKeyCounts.set(line.sourceKey, (sourceKeyCounts.get(line.sourceKey) ?? 0) + 1)
  }

  const mappedLines = pendingLines.map((line) => buildOutboundLine({
    ...line,
    sku: line.row.sku?.trim() || pickByHeaders(line.raw, SABANGNET_SKU_HEADERS) || null,
    productName: line.row.productName || null,
    optionText: line.row.optionText || null,
    quantity: line.row.quantity,
    salesAmount: resolveOutboundSalesAmount({
      parsedAmount: line.row.totalAmount,
      raw: line.raw,
      marketplaceName: line.marketplaceName,
      marketplaceId: line.marketplaceId,
    }),
    shippingFee: line.row.shippingFee ?? null,
    marketplaceFee: parseCurrency(pickByHeaders(line.raw, MARKETPLACE_FEE_HEADERS)),
    profitAmount: parseCurrency(pickByHeaders(line.raw, PROFIT_HEADERS)),
    claimType: claimTypeFromText(pickByHeaders(line.raw, ORDER_STATUS_HEADERS)),
    duplicateInFile: (sourceKeyCounts.get(line.sourceKey) ?? 0) > 1,
    alreadyApplied: appliedKeys.has(line.sourceKey),
    legacyConfirmed: legacyKeys.has(line.sourceKey),
    skuSet,
  }))

  const readyRows = mappedLines.filter((line) => line.reflectionStatus === 'ready').length
  const blockedRows = mappedLines.filter((line) => line.reflectionStatus === 'blocked').length
  const excludedRows = mappedLines.filter((line) => line.reflectionStatus === 'excluded').length
  const totalQuantity = mappedLines.reduce((sum, line) => sum + line.quantity, 0)
  const totalSales = mappedLines.reduce((sum, line) => sum + line.salesAmount, 0)
  const [batch] = resultRows<{ id: string }>(await db.execute(sql`
    INSERT INTO outbound_reflection_batches (
      user_id, source_file_name, file_hash, apply_inventory, total_rows, ready_rows, blocked_rows, excluded_rows, total_quantity, total_sales
    ) VALUES (
      ${input.userId}::uuid, ${input.fileName}, ${fileHash}, ${input.applyInventory ?? true}, ${mappedLines.length}, ${readyRows}, ${blockedRows}, ${excludedRows}, ${totalQuantity}, ${totalSales}
    )
    RETURNING id
  `))

  for (const chunk of chunks(mappedLines, 300)) {
    await db.execute(sql`
      INSERT INTO outbound_reflection_lines (
        batch_id, user_id, row_number, source_key, source_order_number, shipment_date,
        marketplace_name, marketplace_id, sku, product_name, option_text, quantity,
        sales_amount, shipping_fee, marketplace_fee, profit_amount, claim_type,
        reflection_status, issue_codes, issue_messages, raw_data
      ) VALUES ${sql.join(chunk.map((line) => sql`(
        ${batch.id}::uuid, ${input.userId}::uuid, ${line.rowNumber}, ${line.sourceKey}, ${line.sourceOrderNumber}, ${line.shipmentDate}::date,
        ${line.marketplaceName || null}, ${line.marketplaceId}, ${line.sku}, ${line.productName}, ${line.optionText}, ${line.quantity},
        ${line.salesAmount}, ${line.shippingFee}, ${line.marketplaceFee}, ${line.profitAmount}, ${line.claimType},
        ${line.reflectionStatus}, ${JSON.stringify(line.issueCodes)}::jsonb, ${JSON.stringify(line.issueMessages)}::jsonb, ${JSON.stringify(line.raw)}::jsonb
      )`), sql`, `)}
    `)
  }

  return { batchId: batch.id, skipped: false, totalRows: mappedLines.length, readyRows, blockedRows, errors }
}

export async function listOutboundReflectionBatches(userId: string): Promise<OutboundReflectionBatch[]> {
  const rows = resultRows<OutboundReflectionBatch>(await db.execute(sql`
    SELECT
      id,
      source_file_name AS "sourceFileName",
      apply_inventory AS "applyInventory",
      total_rows AS "totalRows",
      ready_rows AS "readyRows",
      blocked_rows AS "blockedRows",
      applied_rows AS "appliedRows",
      excluded_rows AS "excludedRows",
      total_quantity AS "totalQuantity",
      total_sales AS "totalSales",
      created_at AS "createdAt",
      applied_at AS "appliedAt"
    FROM outbound_reflection_batches
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at DESC
    LIMIT 30
  `))
  return rows.map((row) => ({
    ...row,
    applyInventory: Boolean(row.applyInventory),
    totalRows: toNumber(row.totalRows),
    readyRows: toNumber(row.readyRows),
    blockedRows: toNumber(row.blockedRows),
    appliedRows: toNumber(row.appliedRows),
    excludedRows: toNumber(row.excludedRows),
    totalQuantity: toNumber(row.totalQuantity),
    totalSales: toNumber(row.totalSales),
    createdAt: new Date(row.createdAt),
    appliedAt: row.appliedAt ? new Date(row.appliedAt) : null,
  }))
}

export async function deleteOutboundReflectionBatch(userId: string, batchId: string) {
  const [batch] = resultRows<{ appliedRows: number }>(await db.execute(sql`
    SELECT applied_rows AS "appliedRows"
    FROM outbound_reflection_batches
    WHERE id = ${batchId}::uuid
      AND user_id = ${userId}::uuid
    LIMIT 1
  `))

  if (!batch) throw new Error('삭제할 출고반영 파일을 찾을 수 없습니다.')
  if (toNumber(batch.appliedRows) > 0) {
    throw new Error('이미 반영한 파일은 삭제할 수 없습니다. 재고와 매출을 함께 되돌리는 반영 취소가 필요합니다.')
  }

  await db.execute(sql`
    DELETE FROM outbound_reflection_batches
    WHERE id = ${batchId}::uuid
      AND user_id = ${userId}::uuid
  `)

  return { deleted: true }
}

export async function getOutboundReflectionLines(
  userId: string,
  batchId: string,
  options: { status?: OutboundReflectionStatus | 'all'; limit?: number } = {},
): Promise<OutboundReflectionLine[]> {
  const statusFilter = options.status && options.status !== 'all'
    ? sql`AND reflection_status = ${options.status}`
    : sql``
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 300), 500))
  const rows = resultRows<OutboundReflectionLine>(await db.execute(sql`
    SELECT
      id,
      batch_id AS "batchId",
      row_number AS "rowNumber",
      source_order_number AS "sourceOrderNumber",
      shipment_date::text AS "shipmentDate",
      marketplace_name AS "marketplaceName",
      marketplace_id AS "marketplaceId",
      sku,
      product_name AS "productName",
      option_text AS "optionText",
      quantity,
      sales_amount AS "salesAmount",
      shipping_fee AS "shippingFee",
      marketplace_fee AS "marketplaceFee",
      profit_amount AS "profitAmount",
      claim_type AS "claimType",
      reflection_status AS "reflectionStatus",
      issue_codes AS "issueCodes",
      issue_messages AS "issueMessages",
      applied_at AS "appliedAt",
      created_at AS "createdAt"
    FROM outbound_reflection_lines
    WHERE user_id = ${userId}::uuid
      AND batch_id = ${batchId}::uuid
      ${statusFilter}
    ORDER BY row_number ASC
    LIMIT ${limit}
  `))
  return rows.map((row) => {
    const marketplace = normalizeOutboundReflectionMarketplace(row.marketplaceName, row.marketplaceId)
    return {
      ...row,
      marketplaceName: marketplace.name,
      marketplaceId: marketplace.id,
      quantity: toNumber(row.quantity),
      salesAmount: toNumber(row.salesAmount),
      shippingFee: row.shippingFee == null ? null : toNumber(row.shippingFee),
      marketplaceFee: row.marketplaceFee == null ? null : toNumber(row.marketplaceFee),
      profitAmount: row.profitAmount == null ? null : toNumber(row.profitAmount),
      claimType: normalizeClaimType(row.claimType),
      reflectionStatus: row.reflectionStatus as OutboundReflectionStatus,
      issueCodes: Array.isArray(row.issueCodes) ? row.issueCodes as OutboundReflectionIssueCode[] : [],
      issueMessages: Array.isArray(row.issueMessages) ? row.issueMessages : [],
      appliedAt: row.appliedAt ? new Date(row.appliedAt) : null,
      createdAt: new Date(row.createdAt),
    }
  })
}

export async function updateOutboundReflectionLine(
  userId: string,
  lineId: string,
  patch: OutboundReflectionLinePatch,
) {
  const [current] = resultRows<{
    id: string
    batchId: string
    sourceKey: string
    sourceOrderNumber: string
    shipmentDate: string
    marketplaceName: string | null
    marketplaceId: string | null
    sku: string | null
    productName: string | null
    optionText: string | null
    quantity: number
    salesAmount: number
    shippingFee: number | null
    marketplaceFee: number | null
    profitAmount: number | null
    claimType: string | null
    rawData: RawExcelRow
  }>(await db.execute(sql`
    SELECT
      id,
      batch_id AS "batchId",
      source_key AS "sourceKey",
      source_order_number AS "sourceOrderNumber",
      shipment_date::text AS "shipmentDate",
      marketplace_name AS "marketplaceName",
      marketplace_id AS "marketplaceId",
      sku,
      product_name AS "productName",
      option_text AS "optionText",
      quantity,
      sales_amount AS "salesAmount",
      shipping_fee AS "shippingFee",
      marketplace_fee AS "marketplaceFee",
      profit_amount AS "profitAmount",
      claim_type AS "claimType",
      raw_data AS "rawData"
    FROM outbound_reflection_lines
    WHERE id = ${lineId}::uuid
      AND user_id = ${userId}::uuid
      AND reflection_status <> 'applied'
    LIMIT 1
  `))
  if (!current) throw new Error('이미 반영됐거나 수정할 수 없는 출고 행입니다.')

  const [productSkuRows, variantSkuRows, appliedKeys, legacyKeys] = await Promise.all([
    db.select({ sku: products.internalSku }).from(products).where(sql`${products.userId} = ${userId} AND ${products.status} <> 'deleted'`),
    db.select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, sql`${products.id} = ${productVariants.productId}`)
      .where(sql`${products.userId} = ${userId} AND ${products.status} <> 'deleted' AND ${productVariants.isActive} = true`),
    getAppliedSourceKeys(userId),
    getLegacyConfirmedSourceKeys(userId),
  ])
  const skuSet = new Set([
    ...productSkuRows.map((row) => row.sku).filter(Boolean),
    ...variantSkuRows.map((row) => row.sku).filter(Boolean),
  ])
  const line = buildOutboundLine({
    rowNumber: 0,
    sourceOrderNumber: current.sourceOrderNumber,
    sourceKey: current.sourceKey,
    shipmentDate: current.shipmentDate,
    marketplaceName: current.marketplaceName ?? '',
    marketplaceId: current.marketplaceId,
    raw: current.rawData,
    sku: cleanOptionalString(patch.sku) ?? current.sku,
    productName: cleanOptionalString(patch.productName) ?? current.productName,
    optionText: cleanOptionalString(patch.optionText) ?? current.optionText,
    quantity: positiveInteger(patch.quantity, toNumber(current.quantity)),
    salesAmount: nonNegativeNumber(patch.salesAmount, toNumber(current.salesAmount)),
    shippingFee: current.shippingFee == null ? null : toNumber(current.shippingFee),
    marketplaceFee: current.marketplaceFee == null ? null : toNumber(current.marketplaceFee),
    profitAmount: current.profitAmount == null ? null : toNumber(current.profitAmount),
    claimType: normalizeClaimType(current.claimType),
    duplicateInFile: false,
    alreadyApplied: appliedKeys.has(current.sourceKey),
    legacyConfirmed: legacyKeys.has(current.sourceKey),
    skuSet,
  })

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE outbound_reflection_lines
      SET sku = ${line.sku},
          product_name = ${line.productName},
          option_text = ${line.optionText},
          quantity = ${line.quantity},
          sales_amount = ${line.salesAmount},
          reflection_status = ${line.reflectionStatus},
          issue_codes = ${JSON.stringify(line.issueCodes)}::jsonb,
          issue_messages = ${JSON.stringify(line.issueMessages)}::jsonb,
          updated_at = NOW()
      WHERE id = ${lineId}::uuid
        AND user_id = ${userId}::uuid
    `)
    await refreshOutboundReflectionBatchCounts(tx, current.batchId, userId)
  })

  return { id: lineId, reflectionStatus: line.reflectionStatus, issueMessages: line.issueMessages }
}

export async function applyOutboundReflectionBatch(
  userId: string,
  batchId: string,
  options: { limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 300), 500))
  return db.transaction(async (tx) => {
    const [batch] = resultRows<{ applyInventory: boolean }>(await tx.execute(sql`
      SELECT apply_inventory AS "applyInventory"
      FROM outbound_reflection_batches
      WHERE id = ${batchId}::uuid
        AND user_id = ${userId}::uuid
      FOR UPDATE
    `))
    if (!batch) throw new Error('반영할 출고반영 파일을 찾을 수 없습니다.')
    const applyInventory = Boolean(batch.applyInventory)

    const lines = resultRows<{
      id: string
      sourceKey: string
      sku: string | null
      quantity: number
      claimType: string | null
      marketplaceId: string | null
      marketplaceName: string | null
      sourceOrderNumber: string
    }>(await tx.execute(sql`
      SELECT
        id,
        source_key AS "sourceKey",
        sku,
        quantity,
        claim_type AS "claimType",
        marketplace_id AS "marketplaceId",
        marketplace_name AS "marketplaceName",
        source_order_number AS "sourceOrderNumber"
      FROM outbound_reflection_lines
      WHERE user_id = ${userId}::uuid
        AND batch_id = ${batchId}::uuid
        AND reflection_status = 'ready'
      ORDER BY row_number ASC
      LIMIT ${limit}
      FOR UPDATE
    `))

    if (lines.length === 0) {
      const counts = await refreshOutboundReflectionBatchCounts(tx, batchId, userId)
      return { applied: 0, excluded: 0, readyRows: counts.readyRows, done: counts.readyRows === 0 }
    }

    const sourceKeys = lines.map((line) => line.sourceKey)
    const alreadyApplied = new Set(resultRows<{ sourceKey: string }>(await tx.execute(sql`
      SELECT source_key AS "sourceKey"
      FROM outbound_reflection_lines
      WHERE user_id = ${userId}::uuid
        AND reflection_status = 'applied'
        AND source_key IN (${sql.join(sourceKeys.map((key) => sql`${key}`), sql`, `)})
      FOR UPDATE
    `)).map((row) => row.sourceKey))

    let applied = 0
    let excluded = 0
    for (const line of lines) {
      if (alreadyApplied.has(line.sourceKey)) {
        await tx.execute(sql`
          UPDATE outbound_reflection_lines
          SET reflection_status = 'excluded',
              issue_codes = '["already_reflected"]'::jsonb,
              issue_messages = '["다른 반영 파일에서 이미 처리된 출고 행"]'::jsonb,
              updated_at = NOW()
          WHERE id = ${line.id}::uuid
        `)
        excluded += 1
        continue
      }

      const quantity = toNumber(line.quantity)
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`출고 수량이 올바르지 않습니다: ${line.sku ?? line.sourceOrderNumber}`)

      if (applyInventory) {
        const sku = line.sku?.trim()
        if (!sku) throw new Error(`재고 반영 SKU가 없습니다: ${line.sourceOrderNumber}`)

        const claimType = normalizeClaimType(line.claimType)
        const inventoryDelta = claimType === 'return' ? quantity : -quantity
        const adjustmentReason = claimType === 'return' ? 'return' : 'order_ship'
        const result = await adjustStockInTransaction(
          tx,
          userId,
          sku,
          inventoryDelta,
          adjustmentReason,
          {
            warehouseZone: outboundWarehouseZone(line.marketplaceName),
            note: `출고반영 ${line.sourceOrderNumber}${claimType === 'return' ? ' 반품입고' : claimType === 'exchange' ? ' 교환출고' : ''}`,
          },
        )
        if (!result.success) throw new Error(`출고 재고를 찾을 수 없습니다: ${sku}`)
      }

      await tx.execute(sql`
        UPDATE outbound_reflection_lines
        SET reflection_status = 'applied',
            applied_at = NOW(),
            updated_at = NOW()
        WHERE id = ${line.id}::uuid
      `)
      applied += 1
    }

    const counts = await refreshOutboundReflectionBatchCounts(tx, batchId, userId)
    return { applied, excluded, readyRows: counts.readyRows, done: counts.readyRows === 0, applyInventory }
  })
}

export async function getOutboundReflectionSalesAggregates(input: {
  userId: string
  start: string
  end: string
}): Promise<OutboundReflectionSalesAggregate[]> {
  const rows = resultRows<{
    marketplaceId: string | null
    marketplaceName: string | null
    sales: string | number | null
    productCost: string | number | null
    marketplaceFee: string | number | null
    paidShippingFee: string | number | null
    actualShippingFee: string | number | null
    boxCost: string | number | null
    finalProfit: string | number | null
    hasProfitData: boolean | null
  }>(await db.execute(sql`
    WITH applied_lines AS (
      SELECT
        line.*,
        CASE
          WHEN regexp_replace(COALESCE(line.marketplace_name, ''), '\\s+', '', 'g') LIKE '%로켓배송%'
            OR line.marketplace_id = 'coupang-rocket'
            THEN 'coupang-rocket'
          WHEN regexp_replace(COALESCE(line.marketplace_name, ''), '\\s+', '', 'g') LIKE '%대량%'
            THEN 'channel-sales:bulk'
          ELSE NULLIF(line.marketplace_id, '')
        END AS reporting_marketplace_id,
        CASE
          WHEN regexp_replace(COALESCE(line.marketplace_name, ''), '\\s+', '', 'g') LIKE '%로켓배송%'
            OR line.marketplace_id = 'coupang-rocket'
            THEN '로켓배송'
          WHEN regexp_replace(COALESCE(line.marketplace_name, ''), '\\s+', '', 'g') LIKE '%대량%'
            THEN '대량'
          ELSE NULLIF(line.marketplace_name, '')
        END AS reporting_marketplace_name,
        (
          regexp_replace(COALESCE(line.marketplace_name, ''), '\\s+', '', 'g') LIKE '%로켓배송%'
          OR line.marketplace_id = 'coupang-rocket'
          OR regexp_replace(COALESCE(line.marketplace_name, ''), '\\s+', '', 'g') LIKE '%대량%'
        ) AS separately_entered_sales
      FROM outbound_reflection_lines line
      WHERE line.user_id = ${input.userId}::uuid
        AND line.reflection_status = 'applied'
        AND line.shipment_date >= ${input.start}::date
        AND line.shipment_date < ${input.end}::date
    ),
    product_costs AS (
      SELECT p.user_id, p.internal_sku AS sku, ${OUTBOUND_ITEM_COST} AS unit_cost
      FROM products p
      WHERE p.user_id = ${input.userId}::uuid
        -- SKU 통합 전 원가 품목은 deleted 상태로 남고, 활성 품목/옵션에는
        -- 원가 메타데이터가 없다. 출고 SKU와 정확히 일치하는 기존 품목을
        -- 포함해야 Works 원가가 유지된다.
        AND ${OUTBOUND_ITEM_COST} IS NOT NULL
    ),
    order_packaging AS (
      SELECT
        line.source_order_number,
        MIN(line.shipment_date) AS shipment_date,
        CASE
          WHEN COUNT(DISTINCT NULLIF(BTRIM(inventory.packaging_unit), '')) = 1
            AND BOOL_AND(NULLIF(BTRIM(inventory.packaging_unit), '') IS NOT NULL)
            THEN MAX(NULLIF(BTRIM(inventory.packaging_unit), ''))
          ELSE NULL
        END AS fallback_package_name
      FROM applied_lines line
      LEFT JOIN inventory
        ON inventory.user_id = line.user_id
       AND inventory.sku = line.sku
      GROUP BY line.source_order_number
    ),
    outbound_tracking AS (
      SELECT DISTINCT
        line.source_order_number,
        NULLIF(
          REGEXP_REPLACE(
            COALESCE(
              NULLIF(BTRIM(line.raw_data ->> '송장번호'), ''),
              NULLIF(BTRIM(line.raw_data ->> '운송장번호'), ''),
              NULLIF(BTRIM(line.raw_data ->> '운송장 번호'), '')
            ),
            '[^0-9A-Za-z]',
            '',
            'g'
          ),
          ''
        ) AS normalized_tracking_number
      FROM applied_lines line
    ),
    shipping_matches AS (
      SELECT DISTINCT
        packages.source_order_number,
        cost.id AS shipping_cost_id
      FROM order_packaging packages
      INNER JOIN outbound_tracking tracking
        ON tracking.source_order_number = packages.source_order_number
       AND tracking.normalized_tracking_number IS NOT NULL
      INNER JOIN actual_shipping_costs cost
        ON cost.user_id = ${input.userId}::uuid
       AND cost.normalized_tracking_number = tracking.normalized_tracking_number

      UNION

      SELECT DISTINCT
        packages.source_order_number,
        cost.id AS shipping_cost_id
      FROM order_packaging packages
      INNER JOIN actual_shipping_costs cost
        ON cost.user_id = ${input.userId}::uuid
       AND BTRIM(COALESCE(cost.order_number, '')) = BTRIM(packages.source_order_number)
      WHERE NOT EXISTS (
        SELECT 1
        FROM outbound_tracking tracking
        INNER JOIN actual_shipping_costs tracking_cost
          ON tracking_cost.user_id = ${input.userId}::uuid
         AND tracking_cost.normalized_tracking_number = tracking.normalized_tracking_number
        WHERE tracking.source_order_number = packages.source_order_number
          AND tracking.normalized_tracking_number IS NOT NULL
      )
    ),
    shipping_costs AS (
      SELECT
        packages.source_order_number,
        COALESCE(SUM(cost.actual_fee::numeric), 0) AS actual_shipping_fee,
        COALESCE(SUM(
          COALESCE(rate.unit_cost, 0) * GREATEST(COALESCE(cost.quantity, 1), 1)
        ), 0) AS box_cost
      FROM order_packaging packages
      LEFT JOIN shipping_matches matches
        ON matches.source_order_number = packages.source_order_number
      LEFT JOIN actual_shipping_costs cost
        ON cost.id = matches.shipping_cost_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(BTRIM(cost.package_type), ''), packages.fallback_package_name) AS package_name
      ) resolved ON true
      LEFT JOIN LATERAL (
        SELECT rate.unit_cost::numeric AS unit_cost
        FROM box_cost_rates rate
        WHERE rate.user_id = ${input.userId}::uuid
          AND rate.is_active = true
          AND LOWER(BTRIM(rate.package_name)) = LOWER(BTRIM(resolved.package_name))
          AND rate.effective_from <= COALESCE(cost.delivered_at, cost.accepted_at, packages.shipment_date)
        ORDER BY rate.effective_from DESC
        LIMIT 1
      ) rate ON true
      GROUP BY packages.source_order_number
    ),
    order_totals AS (
      SELECT
        line.source_order_number,
        line.reporting_marketplace_id,
        MAX(line.reporting_marketplace_name) AS reporting_marketplace_name,
        COALESCE(SUM(CASE WHEN line.claim_type = 'return' THEN -line.sales_amount ELSE line.sales_amount END), 0) AS sales,
        COALESCE(SUM(CASE WHEN line.claim_type = 'return' THEN -COALESCE(line.marketplace_fee, 0) ELSE COALESCE(line.marketplace_fee, 0) END), 0) AS marketplace_fee,
        COALESCE(SUM(CASE WHEN line.claim_type = 'return' THEN -COALESCE(line.shipping_fee, 0) ELSE COALESCE(line.shipping_fee, 0) END), 0) AS paid_shipping_fee,
        COALESCE(SUM(
          CASE WHEN line.separately_entered_sales THEN 0 ELSE
            CASE WHEN line.claim_type = 'return' THEN -line.quantity ELSE line.quantity END
            * COALESCE(product_cost.unit_cost, 0)
          END
        ), 0) AS product_cost,
        BOOL_AND(line.separately_entered_sales OR product_cost.unit_cost IS NOT NULL) AS has_product_cost,
        COALESCE(SUM(CASE
          WHEN line.separately_entered_sales THEN 0
          WHEN line.claim_type = 'return' THEN -COALESCE(line.profit_amount, 0)
          ELSE COALESCE(line.profit_amount, 0)
        END), 0) AS source_profit,
        BOOL_OR(NOT line.separately_entered_sales AND line.profit_amount IS NOT NULL) AS has_source_profit
      FROM applied_lines line
      LEFT JOIN product_costs product_cost
        ON product_cost.user_id = line.user_id
       AND product_cost.sku = line.sku
      GROUP BY line.source_order_number, line.reporting_marketplace_id
    )
    SELECT
      COALESCE(order_totals.reporting_marketplace_id, 'sabangnet-other') AS "marketplaceId",
      COALESCE(MAX(order_totals.reporting_marketplace_name), '사방넷 출고반영') AS "marketplaceName",
      COALESCE(SUM(order_totals.sales), 0)::text AS sales,
      COALESCE(SUM(order_totals.product_cost), 0)::text AS "productCost",
      COALESCE(SUM(order_totals.marketplace_fee), 0)::text AS "marketplaceFee",
      COALESCE(SUM(order_totals.paid_shipping_fee), 0)::text AS "paidShippingFee",
      COALESCE(SUM(shipping_costs.actual_shipping_fee), 0)::text AS "actualShippingFee",
      COALESCE(SUM(shipping_costs.box_cost), 0)::text AS "boxCost",
      COALESCE(SUM(
        CASE
          WHEN order_totals.has_source_profit THEN order_totals.source_profit
          ELSE order_totals.sales
            - order_totals.marketplace_fee
            + order_totals.paid_shipping_fee
            - order_totals.product_cost
            - COALESCE(shipping_costs.actual_shipping_fee, 0)
            - COALESCE(shipping_costs.box_cost, 0)
        END
      ), 0)::text AS "finalProfit",
      BOOL_AND(order_totals.has_source_profit OR order_totals.has_product_cost) AS "hasProfitData"
    FROM order_totals
    LEFT JOIN shipping_costs
      ON shipping_costs.source_order_number = order_totals.source_order_number
    GROUP BY order_totals.reporting_marketplace_id
    ORDER BY sales DESC
  `))
  return rows.map((row) => ({
    marketplaceId: row.marketplaceId || 'sabangnet-other',
    marketplaceName: row.marketplaceName || '사방넷 출고반영',
    sales: toNumber(row.sales),
    productCost: toNumber(row.productCost),
    marketplaceFee: toNumber(row.marketplaceFee),
    paidShippingFee: toNumber(row.paidShippingFee),
    actualShippingFee: toNumber(row.actualShippingFee),
    boxCost: toNumber(row.boxCost),
    finalProfit: toNumber(row.finalProfit),
    hasProfitData: Boolean(row.hasProfitData),
  }))
}

function buildOutboundLine(input: {
  rowNumber: number
  sourceOrderNumber: string
  sourceKey: string
  shipmentDate: string
  marketplaceName: string
  marketplaceId: string | null
  raw: RawExcelRow
  sku: string | null
  productName: string | null
  optionText: string | null
  quantity: number
  salesAmount: number
  shippingFee: number | null
  marketplaceFee: number | null
  profitAmount: number | null
  claimType: OutboundClaimType
  duplicateInFile: boolean
  alreadyApplied: boolean
  legacyConfirmed: boolean
  skuSet: Set<string>
}) {
  const issueCodes: OutboundReflectionIssueCode[] = []
  const issueMessages: string[] = []
  const sku = input.sku?.trim() || null
  const isCancel = input.claimType === 'cancel'

  pushIssue(input.duplicateInFile, 'duplicate_in_file', '파일 안에 동일한 사방넷 주문번호와 SKU가 중복되었습니다.')
  pushIssue(input.alreadyApplied, 'already_reflected', '다른 출고반영 파일에서 이미 처리된 출고 행입니다.')
  pushIssue(input.legacyConfirmed, 'legacy_order_exists', '기존 사방넷 검수에서 주문으로 확정된 행입니다.')
  pushIssue(!sku || !input.skuSet.has(sku), 'sku_unmatched', '품목 SKU를 찾지 못했습니다.')
  pushIssue(!Number.isInteger(input.quantity) || input.quantity <= 0, 'quantity_invalid', '출고 수량이 올바르지 않습니다.')

  const reflectionStatus: OutboundReflectionStatus = isCancel || input.alreadyApplied || input.legacyConfirmed
    ? 'excluded'
    : issueCodes.length === 0
      ? 'ready'
      : 'blocked'

  return {
    ...input,
    sku,
    quantity: Math.trunc(toNumber(input.quantity)),
    salesAmount: Math.max(0, toNumber(input.salesAmount)),
    shippingFee: input.shippingFee == null ? null : toNumber(input.shippingFee),
    marketplaceFee: input.marketplaceFee == null ? null : toNumber(input.marketplaceFee),
    profitAmount: input.profitAmount == null ? null : toNumber(input.profitAmount),
    reflectionStatus,
    issueCodes,
    issueMessages: isCancel ? ['취소 주문은 재고와 매출에 반영하지 않습니다.'] : issueMessages,
  }

  function pushIssue(condition: boolean, code: OutboundReflectionIssueCode, message: string) {
    if (!condition) return
    issueCodes.push(code)
    issueMessages.push(message)
  }
}

async function refreshOutboundReflectionBatchCounts(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  batchId: string,
  userId: string,
) {
  const [counts] = resultRows<{
    readyRows: number
    blockedRows: number
    appliedRows: number
    excludedRows: number
  }>(await tx.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE reflection_status = 'ready')::int AS "readyRows",
      COUNT(*) FILTER (WHERE reflection_status = 'blocked')::int AS "blockedRows",
      COUNT(*) FILTER (WHERE reflection_status = 'applied')::int AS "appliedRows",
      COUNT(*) FILTER (WHERE reflection_status = 'excluded')::int AS "excludedRows"
    FROM outbound_reflection_lines
    WHERE user_id = ${userId}::uuid
      AND batch_id = ${batchId}::uuid
  `))
  const normalized = {
    readyRows: toNumber(counts?.readyRows),
    blockedRows: toNumber(counts?.blockedRows),
    appliedRows: toNumber(counts?.appliedRows),
    excludedRows: toNumber(counts?.excludedRows),
  }
  await tx.execute(sql`
    UPDATE outbound_reflection_batches
    SET ready_rows = ${normalized.readyRows},
        blocked_rows = ${normalized.blockedRows},
        applied_rows = ${normalized.appliedRows},
        excluded_rows = ${normalized.excludedRows},
        applied_at = CASE WHEN ${normalized.readyRows} = 0 AND ${normalized.appliedRows} > 0 THEN NOW() ELSE applied_at END
    WHERE id = ${batchId}::uuid
      AND user_id = ${userId}::uuid
  `)
  return normalized
}

async function getAppliedSourceKeys(userId: string) {
  const rows = resultRows<{ sourceKey: string }>(await db.execute(sql`
    SELECT source_key AS "sourceKey"
    FROM outbound_reflection_lines
    WHERE user_id = ${userId}::uuid
      AND reflection_status = 'applied'
  `))
  return new Set(rows.map((row) => row.sourceKey))
}

async function getLegacyConfirmedSourceKeys(userId: string) {
  try {
    const rows = resultRows<{ rawData: RawExcelRow; parsedData: ParsedOrderRow }>(await db.execute(sql`
      SELECT
        review_line.raw_data AS "rawData",
        review_line.parsed_data AS "parsedData"
      FROM sabangnet_review_lines review_line
      INNER JOIN orders legacy_order ON legacy_order.id = review_line.confirmed_order_id
      WHERE review_line.user_id = ${userId}::uuid
        AND legacy_order.status::text IN ('shipped', 'delivering', 'delivered')
    `))
    return new Set(rows.map((row) => createSourceKey(
      pickByHeaders(row.rawData ?? {}, SABANGNET_ORDER_NUMBER_HEADERS) || row.parsedData?.orderNumber || '',
      pickByHeaders(row.rawData ?? {}, SABANGNET_SKU_HEADERS) || row.parsedData?.sku || '',
    )).filter(Boolean))
  } catch {
    return new Set<string>()
  }
}

async function parseRawRows(buffer: Buffer): Promise<RawExcelRow[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return []
  const headerRowNumber = findBestRawHeaderRow(sheet)
  const headers: string[] = []
  sheet.getRow(headerRowNumber).eachCell((cell, column) => {
    headers[column] = cellText(cell.value)
  })

  const rows: RawExcelRow[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return
    const record: RawExcelRow = {}
    row.eachCell((cell, column) => {
      const header = headers[column]
      if (header) record[header] = cellText(cell.value)
    })
    if (Object.values(record).some(Boolean)) rows.push(record)
  })
  return rows
}

function findBestRawHeaderRow(sheet: ExcelJS.Worksheet): number {
  let best = 1
  let bestScore = -1
  for (let rowNumber = 1; rowNumber <= Math.min(20, sheet.rowCount); rowNumber += 1) {
    const values = sheet.getRow(rowNumber).values
    const text = (Array.isArray(values) ? values : []).map((value) => cellText(value as ExcelJS.CellValue)).join('|')
    const score = ['주문번호', '쇼핑몰', '상품', '수량', '금액', '상태'].reduce((sum, key) => sum + (text.includes(key) ? 1 : 0), 0)
    if (score > bestScore) {
      best = rowNumber
      bestScore = score
    }
  }
  return best
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim()
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('result' in value && value.result != null) return String(value.result).trim()
  }
  return String(value).trim()
}

function pickByHeaders(row: RawExcelRow, candidates: string[]): string {
  for (const [header, value] of Object.entries(row)) {
    const normalizedHeader = normalizeKey(header)
    if (candidates.some((candidate) => normalizedHeader.includes(normalizeKey(candidate)))) return value?.trim() ?? ''
  }
  return ''
}

function claimTypeFromText(value: string): OutboundClaimType {
  const text = value.replace(/\s+/g, '')
  if (!text) return null
  if (text.includes('취소')) return 'cancel'
  if (text.includes('반품')) return 'return'
  if (text.includes('교환')) return 'exchange'
  return null
}

function normalizeClaimType(value: unknown): OutboundClaimType {
  return value === 'cancel' || value === 'return' || value === 'exchange' ? value : null
}

function createSourceKey(orderNumber: string, sku: string): string {
  const orderKey = normalizeKey(orderNumber)
  const skuKey = normalizeKey(sku)
  return orderKey && skuKey ? `${orderKey}::${skuKey}` : ''
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '')
}

function formatShipmentDate(value: string): string {
  const trimmed = value.trim()
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const formatted = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (formatted) return `${formatted[1]}-${formatted[2].padStart(2, '0')}-${formatted[3].padStart(2, '0')}`

  const parsed = parseImportedOrderedAt(trimmed)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function outboundWarehouseZone(marketplaceName: string | null) {
  const normalizedName = normalizeKey(marketplaceName ?? '')
  if (normalizedName.includes(normalizeKey('로켓배송'))) return '쿠팡'
  return '1창고'
}

export function normalizeOutboundReflectionMarketplace(
  marketplaceName: string | null | undefined,
  marketplaceId: string | null | undefined,
): { name: string | null; id: string | null } {
  const name = marketplaceName?.trim() || null
  const id = marketplaceId?.trim() || null
  if (normalizeKey(name ?? '').includes(normalizeKey('로켓배송')) || id === 'coupang-rocket') {
    return { name: '로켓배송', id: 'coupang-rocket' }
  }
  if (normalizeKey(name ?? '').includes(normalizeKey('대량'))) {
    return { name: '대량', id: 'channel-sales:bulk' }
  }
  return { name, id }
}

export function resolveOutboundSalesAmount(input: {
  parsedAmount: number
  raw: RawExcelRow
  marketplaceName: string | null | undefined
  marketplaceId: string | null | undefined
}): number {
  const parsedAmount = Math.max(0, toNumber(input.parsedAmount))
  if (parsedAmount > 0) return parsedAmount

  const marketplaceKey = normalizeKey(`${input.marketplaceName ?? ''} ${input.marketplaceId ?? ''}`)
  const isSeparatelyEntered = marketplaceKey.includes(normalizeKey('로켓배송'))
    || marketplaceKey.includes(normalizeKey('대량'))
    || input.marketplaceId === 'coupang-rocket'
  if (isSeparatelyEntered) return parsedAmount

  const salesTotal = parseCurrency(pickByHeaders(input.raw, SALES_TOTAL_HEADERS))
  return salesTotal != null && salesTotal > 0 ? salesTotal : parsedAmount
}

function parseCurrency(value: string): number | null {
  if (!value.trim()) return null
  const normalized = value.replaceAll(',', '').replace(/[₩원\s]/g, '')
  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveInteger(value: unknown, fallback: number): number {
  const amount = Number(value)
  return Number.isInteger(amount) && amount > 0 ? amount : fallback
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : fallback
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: T[] }).rows
  }
  return []
}

function toNumber(value: unknown): number {
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
