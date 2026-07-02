import ExcelJS from 'exceljs'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { marketplaceConnections, orders, orderItems, products, productVariants } from '@/lib/db/schema'
import { parseOrderExcel, type ParsedOrderRow } from '@/lib/orders/excel-import'
import type { OrderImportMapping } from '@/lib/orders/excel-import-fields'
import { parseImportedOrderedAt } from '@/lib/orders/import-date'
import { normalizeImportedOrderItem } from '@/lib/orders/import-normalize'
import { splitPhonePair } from '@/lib/orders/phone-normalize'
import { normalizeShippingAddress } from '@/lib/orders/shipping-address'
import { generateInternalNo } from '@/lib/orders/internal-no'

export type SabangnetReviewStatus = 'ready' | 'blocked' | 'confirmed' | 'excluded'

export type SabangnetReviewIssueCode =
  | 'duplicate_in_file'
  | 'existing_order'
  | 'marketplace_unmatched'
  | 'sku_unmatched'
  | 'amount_invalid'
  | 'quantity_invalid'
  | 'shipping_fee_invalid'
  | 'claim_status'

export type SabangnetReviewLine = {
  id: string
  batchId: string
  rowNumber: number
  orderNumber: string
  sabangnetOrderNumber: string | null
  marketplaceOrderNumber: string | null
  productName: string | null
  optionText: string | null
  marketplaceName: string | null
  marketplaceId: string | null
  marketplaceMatched: boolean
  existingOrder: boolean
  duplicateInFile: boolean
  sku: string | null
  skuMatched: boolean
  quantity: number
  totalAmount: number
  shippingFee: number | null
  orderStatusText: string | null
  claimType: string | null
  reviewStatus: SabangnetReviewStatus
  issueCodes: SabangnetReviewIssueCode[]
  issueMessages: string[]
  confirmedOrderId: string | null
  createdAt: Date
}

export type SabangnetReviewLinePatch = {
  orderNumber?: string
  marketplaceName?: string
  marketplaceId?: string
  sku?: string
  productName?: string
  optionText?: string
  quantity?: number
  totalAmount?: number
  shippingFee?: number | null
}

export type SabangnetReviewBatch = {
  id: string
  sourceFileName: string
  totalRows: number
  readyRows: number
  blockedRows: number
  confirmedRows: number
  createdAt: Date
}

type RawExcelRow = Record<string, string>

type MarketplaceConnectionForReview = {
  id: string | null
  marketplaceId: string
  displayName: string
  metadata: Record<string, unknown> | null
}

const ORDER_STATUS_HEADERS = ['주문상태', '상태', 'CS상태', '클레임상태', '처리상태']
const MARKETPLACE_HEADERS = ['쇼핑몰명', '마켓명', '쇼핑몰', '마켓', '사이트명', '판매처']
const KNOWN_MARKETPLACE_ALIASES: Array<{ marketplaceId: string; displayName: string; aliases: string[] }> = [
  { marketplaceId: 'ably', displayName: '에이블리', aliases: ['에이블리', 'ably', 'a-bly'] },
  { marketplaceId: 'naver', displayName: '스마트스토어', aliases: ['스마트스토어', '네이버', 'naver'] },
  { marketplaceId: 'ohouse', displayName: '오늘의집', aliases: ['오늘의집', 'ohouse'] },
  { marketplaceId: 'ssgmall', displayName: '신세계몰', aliases: ['신세계몰', 'ssg', 'ssgmall'] },
  { marketplaceId: 'coupang', displayName: '쿠팡', aliases: ['쿠팡', 'coupang'] },
  { marketplaceId: 'elevenst', displayName: '11번가', aliases: ['11번가', 'elevenst'] },
  { marketplaceId: 'gmarket', displayName: 'G마켓', aliases: ['g마켓', '지마켓', 'esm지마켓', 'gmarket'] },
  { marketplaceId: 'auction', displayName: '옥션', aliases: ['옥션', 'esm옥션', 'auction'] },
  { marketplaceId: 'kakao-gift', displayName: '카카오톡선물하기', aliases: ['카카오톡선물하기', '카카오선물하기', '카카오선물', 'kakao gift'] },
  { marketplaceId: 'kakao-store', displayName: '카카오톡스토어', aliases: ['카카오톡스토어', '카카오스토어', 'kakao store'] },
  { marketplaceId: 'cjonestyle', displayName: 'CJ온스타일', aliases: ['cj온스타일', 'cjonestyle'] },
  { marketplaceId: 'hyundai-hmall', displayName: '현대홈쇼핑', aliases: ['현대h몰', '현대홈쇼핑', '현대홈쇼핑3', 'hmall', 'hyundai hmall'] },
  { marketplaceId: 'gs-shop', displayName: 'GS shop', aliases: ['gs shop', 'gsshop', 'gs샵'] },
  { marketplaceId: 'nsmall', displayName: 'NS홈쇼핑(신)', aliases: ['ns홈쇼핑', 'ns홈쇼핑신', 'nsmall'] },
]

const TABLE_SQL = sql`
  CREATE TABLE IF NOT EXISTS sabangnet_review_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    source_file_name varchar(255) NOT NULL,
    total_rows integer NOT NULL DEFAULT 0,
    ready_rows integer NOT NULL DEFAULT 0,
    blocked_rows integer NOT NULL DEFAULT 0,
    confirmed_rows integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS sabangnet_review_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES sabangnet_review_batches(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    row_number integer NOT NULL,
    order_number varchar(200) NOT NULL,
    marketplace_name text,
    marketplace_id varchar(50),
    marketplace_matched boolean NOT NULL DEFAULT false,
    existing_order boolean NOT NULL DEFAULT false,
    duplicate_in_file boolean NOT NULL DEFAULT false,
    sku varchar(100),
    sku_matched boolean NOT NULL DEFAULT false,
    quantity integer NOT NULL DEFAULT 0,
    total_amount numeric(12,2) NOT NULL DEFAULT 0,
    shipping_fee numeric(12,2),
    order_status_text text,
    claim_type varchar(50),
    review_status varchar(30) NOT NULL DEFAULT 'blocked',
    issue_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
    issue_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
    parsed_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    confirmed_order_id uuid,
    confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS sabangnet_review_batches_user_created_idx
    ON sabangnet_review_batches(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS sabangnet_review_lines_batch_idx
    ON sabangnet_review_lines(batch_id, row_number);
  CREATE INDEX IF NOT EXISTS sabangnet_review_lines_batch_status_idx
    ON sabangnet_review_lines(user_id, batch_id, review_status, row_number);
`

export async function ensureSabangnetReviewTables() {
  await db.execute(TABLE_SQL)
}

export async function importSabangnetReviewBatch(input: {
  userId: string
  fileName: string
  fileBuffer: ArrayBuffer
  mappings?: OrderImportMapping[]
  fallbackMarketplaceId?: string
  fallbackMarketplaceName?: string
}) {
  await ensureSabangnetReviewTables()
  const buffer = Buffer.from(input.fileBuffer)
  const [parseResult, rawRows] = await Promise.all([
    parseOrderExcel(buffer, input.mappings),
    parseRawRows(buffer),
  ])

  if (parseResult.rows.length === 0) {
    return { batchId: null, totalRows: 0, readyRows: 0, blockedRows: 0, errors: parseResult.errors }
  }

  const lineCounts = new Map<string, number>()
  for (const [index, row] of parseResult.rows.entries()) {
    const raw = rawRows[index] ?? {}
    const key = getDuplicateLineKey(row, raw)
    lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1)
  }

  const [connections, productSkuRows, variantSkuRows, existingRows] = await Promise.all([
    db
      .select({
        id: marketplaceConnections.id,
        marketplaceId: marketplaceConnections.marketplaceId,
        displayName: marketplaceConnections.displayName,
        metadata: marketplaceConnections.metadata,
      })
      .from(marketplaceConnections)
      .where(sql`${marketplaceConnections.userId} = ${input.userId}`),
    db
      .select({ sku: products.internalSku })
      .from(products)
      .where(sql`${products.userId} = ${input.userId} AND ${products.status} <> 'deleted'`),
    db
      .select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, sql`${products.id} = ${productVariants.productId}`)
      .where(sql`${products.userId} = ${input.userId} AND ${products.status} <> 'deleted' AND ${productVariants.isActive} = true`),
    db
      .select({ marketplaceId: orders.marketplaceId, marketplaceOrderId: orders.marketplaceOrderId })
      .from(orders)
      .where(sql`${orders.userId} = ${input.userId}`),
  ])

  const skuSet = new Set([
    ...productSkuRows.map((row) => row.sku).filter(Boolean),
    ...variantSkuRows.map((row) => row.sku).filter(Boolean),
  ])
  const existingSet = new Set(existingRows.map((row) => `${row.marketplaceId}:${row.marketplaceOrderId}`))

  const mappedLines = parseResult.rows.map((row, index) => {
    const raw = rawRows[index] ?? {}
    const rawMarketplaceName = pickByHeaders(raw, MARKETPLACE_HEADERS)
    const marketplaceName = rawMarketplaceName || input.fallbackMarketplaceName || input.fallbackMarketplaceId || ''
    const connection = matchMarketplaceConnection(connections, marketplaceName, input.fallbackMarketplaceId)
    const normalized = normalizeImportedOrderItem(row, connection?.marketplaceId ?? input.fallbackMarketplaceId ?? 'sabangnet')
    return buildReviewLine({
      row,
      normalized,
      raw,
      rowNumber: index + 1,
      duplicateInFile: (lineCounts.get(getDuplicateLineKey(row, raw)) ?? 0) > 1,
      connection,
      skuSet,
      existingSet,
      marketplaceName,
    })
  })

  const readyRows = mappedLines.filter((line) => line.reviewStatus === 'ready').length
  const blockedRows = mappedLines.length - readyRows
  const [batch] = resultRows(await db.execute<{ id: string }>(sql`
    INSERT INTO sabangnet_review_batches (user_id, source_file_name, total_rows, ready_rows, blocked_rows)
    VALUES (${input.userId}, ${input.fileName}, ${mappedLines.length}, ${readyRows}, ${blockedRows})
    RETURNING id
  `))

  for (const chunk of chunks(mappedLines, 500)) {
    await db.execute(sql`
      INSERT INTO sabangnet_review_lines (
        batch_id, user_id, row_number, order_number, marketplace_name, marketplace_id,
        marketplace_matched, existing_order, duplicate_in_file, sku, sku_matched,
        quantity, total_amount, shipping_fee, order_status_text, claim_type,
        review_status, issue_codes, issue_messages, parsed_data, raw_data
      )
      VALUES ${sql.join(chunk.map((line) => sql`(
        ${batch.id}::uuid,
        ${input.userId}::uuid,
        ${line.rowNumber},
        ${line.orderNumber},
        ${line.marketplaceName},
        ${line.marketplaceId},
        ${line.marketplaceMatched},
        ${line.existingOrder},
        ${line.duplicateInFile},
        ${line.sku},
        ${line.skuMatched},
        ${line.quantity},
        ${line.totalAmount},
        ${line.shippingFee},
        ${line.orderStatusText},
        ${line.claimType},
        ${line.reviewStatus},
        ${JSON.stringify(line.issueCodes)}::jsonb,
        ${JSON.stringify(line.issueMessages)}::jsonb,
        ${JSON.stringify(line.parsed)}::jsonb,
        ${JSON.stringify(line.raw)}::jsonb
      )`), sql`, `)}
    `)
  }

  return { batchId: batch.id, totalRows: mappedLines.length, readyRows, blockedRows, errors: parseResult.errors }
}

export async function listSabangnetReviewBatches(userId: string): Promise<SabangnetReviewBatch[]> {
  return resultRows(await db.execute<SabangnetReviewBatch>(sql`
    SELECT
      id,
      source_file_name AS "sourceFileName",
      total_rows AS "totalRows",
      ready_rows AS "readyRows",
      blocked_rows AS "blockedRows",
      confirmed_rows AS "confirmedRows",
      created_at AS "createdAt"
    FROM sabangnet_review_batches
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 20
  `)).map((row) => ({ ...row, createdAt: new Date(row.createdAt) }))
}

export async function getSabangnetReviewLines(
  userId: string,
  batchId?: string,
  options: { status?: SabangnetReviewStatus | 'all'; limit?: number } = {},
): Promise<SabangnetReviewLine[]> {
  const whereBatch = batchId ? sql`AND batch_id = ${batchId}::uuid` : sql``
  const whereStatus = options.status && options.status !== 'all'
    ? sql`AND review_status = ${options.status}`
    : sql``
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 300), 500))
  return resultRows(await db.execute<SabangnetReviewLine>(sql`
    SELECT
      id,
      batch_id AS "batchId",
      row_number AS "rowNumber",
      order_number AS "orderNumber",
      COALESCE(NULLIF(raw_data->>'사방넷 주문번호', ''), order_number) AS "sabangnetOrderNumber",
      NULLIF(raw_data->>'주문번호(쇼핑몰)', '') AS "marketplaceOrderNumber",
      parsed_data->>'productName' AS "productName",
      parsed_data->>'optionText' AS "optionText",
      marketplace_name AS "marketplaceName",
      marketplace_id AS "marketplaceId",
      marketplace_matched AS "marketplaceMatched",
      existing_order AS "existingOrder",
      duplicate_in_file AS "duplicateInFile",
      sku,
      sku_matched AS "skuMatched",
      quantity,
      total_amount AS "totalAmount",
      shipping_fee AS "shippingFee",
      order_status_text AS "orderStatusText",
      claim_type AS "claimType",
      review_status AS "reviewStatus",
      issue_codes AS "issueCodes",
      issue_messages AS "issueMessages",
      confirmed_order_id AS "confirmedOrderId",
      created_at AS "createdAt"
    FROM sabangnet_review_lines
    WHERE user_id = ${userId}
    ${whereBatch}
    ${whereStatus}
    ORDER BY row_number ASC
    LIMIT ${limit}
  `)).map((row) => ({
    ...row,
    quantity: Number(row.quantity),
    totalAmount: Number(row.totalAmount),
    shippingFee: row.shippingFee == null ? null : Number(row.shippingFee),
    issueCodes: Array.isArray(row.issueCodes) ? row.issueCodes : [],
    issueMessages: Array.isArray(row.issueMessages) ? row.issueMessages : [],
    createdAt: new Date(row.createdAt),
  }))
}

export async function updateSabangnetReviewLine(
  userId: string,
  lineId: string,
  patch: SabangnetReviewLinePatch,
) {
  await ensureSabangnetReviewTables()

  const [current] = resultRows(await db.execute<{
    id: string
    batchId: string
    rowNumber: number
    parsedData: ParsedOrderRow
    rawData: RawExcelRow
  }>(sql`
    SELECT
      id,
      batch_id AS "batchId",
      row_number AS "rowNumber",
      parsed_data AS "parsedData",
      raw_data AS "rawData"
    FROM sabangnet_review_lines
    WHERE id = ${lineId}::uuid
      AND user_id = ${userId}
      AND confirmed_order_id IS NULL
    LIMIT 1
  `))

  if (!current) throw new Error('수정할 수 있는 검수 행을 찾을 수 없습니다.')

  const parsed: ParsedOrderRow = {
    ...current.parsedData,
    orderNumber: cleanString(patch.orderNumber) || getSabangnetOrderNumber(current.rawData) || current.parsedData.orderNumber,
    productName: cleanString(patch.productName) || current.parsedData.productName,
    optionText: cleanOptionalString(patch.optionText) ?? current.parsedData.optionText,
    sku: cleanOptionalString(patch.sku) ?? current.parsedData.sku,
    quantity: normalizePositiveInteger(patch.quantity, current.parsedData.quantity),
    totalAmount: normalizeNonNegativeNumber(patch.totalAmount, current.parsedData.totalAmount),
    shippingFee: patch.shippingFee === null
      ? undefined
      : patch.shippingFee === undefined
        ? current.parsedData.shippingFee
        : normalizeNonNegativeNumber(patch.shippingFee, current.parsedData.shippingFee ?? 0),
  }
  const marketplaceName = cleanString(patch.marketplaceName) || pickByHeaders(current.rawData, MARKETPLACE_HEADERS)
  const fallbackMarketplaceId = cleanOptionalString(patch.marketplaceId) ?? undefined

  const [connections, productSkuRows, variantSkuRows, existingRows, duplicateRows] = await Promise.all([
    getMarketplaceConnections(userId),
    db.select({ sku: products.internalSku }).from(products).where(sql`${products.userId} = ${userId} AND ${products.status} <> 'deleted'`),
    db.select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, sql`${products.id} = ${productVariants.productId}`)
      .where(sql`${products.userId} = ${userId} AND ${products.status} <> 'deleted' AND ${productVariants.isActive} = true`),
    db.select({ marketplaceId: orders.marketplaceId, marketplaceOrderId: orders.marketplaceOrderId })
      .from(orders)
      .where(sql`${orders.userId} = ${userId}`),
    db.execute<{ parsedData: ParsedOrderRow; rawData: RawExcelRow }>(sql`
      SELECT
        parsed_data AS "parsedData",
        raw_data AS "rawData"
      FROM sabangnet_review_lines
      WHERE user_id = ${userId}
        AND batch_id = ${current.batchId}::uuid
        AND id <> ${lineId}::uuid
        AND order_number = ${parsed.orderNumber}
    `).then(resultRows),
  ])

  const skuSet = new Set([
    ...productSkuRows.map((row) => row.sku).filter(Boolean),
    ...variantSkuRows.map((row) => row.sku).filter(Boolean),
  ])
  const existingSet = new Set(existingRows.map((row) => `${row.marketplaceId}:${row.marketplaceOrderId}`))
  const duplicateLineKey = getDuplicateLineKey(parsed, current.rawData)
  const duplicateInFile = duplicateRows.some((row) => getDuplicateLineKey(row.parsedData, row.rawData) === duplicateLineKey)
  const connection = matchMarketplaceConnection(connections, marketplaceName || fallbackMarketplaceId || '', fallbackMarketplaceId)
  const normalized = normalizeImportedOrderItem(parsed, connection?.marketplaceId ?? fallbackMarketplaceId ?? 'sabangnet')
  const reviewLine = buildReviewLine({
    row: parsed,
    normalized,
    raw: current.rawData,
    rowNumber: current.rowNumber,
    duplicateInFile,
    connection,
    skuSet,
    existingSet,
    marketplaceName,
  })

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE sabangnet_review_lines
      SET order_number = ${reviewLine.orderNumber},
          marketplace_name = ${reviewLine.marketplaceName},
          marketplace_id = ${reviewLine.marketplaceId},
          marketplace_matched = ${reviewLine.marketplaceMatched},
          existing_order = ${reviewLine.existingOrder},
          duplicate_in_file = ${reviewLine.duplicateInFile},
          sku = ${reviewLine.sku},
          sku_matched = ${reviewLine.skuMatched},
          quantity = ${reviewLine.quantity},
          total_amount = ${reviewLine.totalAmount},
          shipping_fee = ${reviewLine.shippingFee},
          order_status_text = ${reviewLine.orderStatusText},
          claim_type = ${reviewLine.claimType},
          review_status = ${reviewLine.reviewStatus},
          issue_codes = ${JSON.stringify(reviewLine.issueCodes)}::jsonb,
          issue_messages = ${JSON.stringify(reviewLine.issueMessages)}::jsonb,
          parsed_data = ${JSON.stringify(reviewLine.parsed)}::jsonb,
          updated_at = NOW()
      WHERE id = ${lineId}::uuid
        AND user_id = ${userId}
    `)

    await refreshSabangnetReviewBatchCounts(tx, current.batchId, userId)
  })

  return {
    id: lineId,
    reviewStatus: reviewLine.reviewStatus,
    issueCodes: reviewLine.issueCodes,
    issueMessages: reviewLine.issueMessages,
  }
}

export async function confirmSabangnetReviewBatch(
  userId: string,
  batchId: string,
  options: { maxOrderGroups?: number } = {},
) {
  await ensureSabangnetReviewTables()
  const lines = resultRows(await db.execute<{
    id: string
    marketplaceId: string
    orderNumber: string
    claimType: string | null
    parsedData: ParsedOrderRow
    rawData: RawExcelRow
  }>(sql`
    SELECT
      id,
      marketplace_id AS "marketplaceId",
      order_number AS "orderNumber",
      claim_type AS "claimType",
      parsed_data AS "parsedData",
      raw_data AS "rawData"
    FROM sabangnet_review_lines
    WHERE user_id = ${userId}
      AND batch_id = ${batchId}::uuid
      AND review_status = 'ready'
      AND confirmed_order_id IS NULL
    ORDER BY row_number ASC
  `))

  let confirmed = 0
  let excluded = 0
  await db.transaction(async (tx) => {
    const excludedLines = lines.filter((line) => line.claimType === 'cancel' || line.claimType === 'return')
    if (excludedLines.length > 0) {
      await tx.execute(sql`
        UPDATE sabangnet_review_lines
        SET review_status = 'excluded',
            confirmed_at = NOW(),
            updated_at = NOW()
        WHERE id IN (${sql.join(excludedLines.map((line) => sql`${line.id}::uuid`), sql`, `)})
          AND user_id = ${userId}
      `)
      excluded += excludedLines.length
    }

    const groupedLines = new Map<string, typeof lines>()
    for (const line of lines.filter((line) => line.claimType !== 'cancel' && line.claimType !== 'return')) {
      const effectiveOrderNumber = getSabangnetOrderNumber(line.rawData) || line.orderNumber
      const groupKey = `${line.marketplaceId}:${effectiveOrderNumber}`
      const group = groupedLines.get(groupKey) ?? []
      group.push(line)
      groupedLines.set(groupKey, group)
    }

    const orderRows: Array<typeof orders.$inferInsert> = []
    const itemRows: Array<typeof orderItems.$inferInsert> = []
    const lineUpdates: Array<{ lineId: string; orderId: string }> = []

    const groupsToConfirm = options.maxOrderGroups
      ? Array.from(groupedLines.values()).slice(0, Math.max(0, options.maxOrderGroups))
      : Array.from(groupedLines.values())

    for (const group of groupsToConfirm) {
      const firstLine = group[0]
      const parsed = firstLine.parsedData
      const effectiveOrderNumber = getSabangnetOrderNumber(firstLine.rawData) || firstLine.orderNumber
      const orderedAt = parseImportedOrderedAt(parsed.orderedAt)
      const buyerPhones = splitPhonePair(parsed.buyerPhone)
      const recipientPhones = splitPhonePair(parsed.recipientPhone)
      const shippingAddress = normalizeShippingAddress({
        zipCode: parsed.zipCode ?? '',
        address1: parsed.recipientAddress,
      })
      const orderShippingFee = group.reduce((sum, line) => sum + Number(line.parsedData.shippingFee || 0), 0)
      const hasExchange = group.some((line) => line.claimType === 'exchange')
      const orderTotalAmount = hasExchange
        ? 0
        : group.reduce((sum, line) => sum + Number(line.parsedData.totalAmount || 0), 0)

      const orderId = randomUUID()
      orderRows.push({
        id: orderId,
        internalNo: generateInternalNo(),
        userId,
        connectionId: null,
        marketplaceId: firstLine.marketplaceId,
        marketplaceOrderId: effectiveOrderNumber,
        status: 'new',
        buyerName: parsed.buyerName,
        buyerPhone: buyerPhones.phone1,
        buyerPhone2: buyerPhones.phone2,
        recipientName: parsed.recipientName,
        recipientPhone: recipientPhones.phone1,
        recipientPhone2: recipientPhones.phone2,
        shippingAddress,
        orderedAt,
        totalAmount: String(orderTotalAmount),
        shippingFee: !hasExchange && orderShippingFee > 0 ? String(orderShippingFee) : null,
        deliveryMessage: parsed.deliveryMessage ?? null,
        rawData: {
          source: 'sabangnet-review',
          collectionSource: 'sabangnet-review',
          reviewBatchId: batchId,
          reviewLineOrderNumbers: group.map((line) => line.orderNumber),
          rawLines: group.map((line) => line.rawData),
          analyticsPolicy: 'cancel-return-exclude-exchange-initial-shipping-x2',
          analyticsClaimType: hasExchange ? 'exchange' : null,
          exchangeInitialShippingFee: hasExchange ? orderShippingFee : null,
          exchangeShippingCostMultiplier: hasExchange ? 2 : null,
        },
        marketplaceStatus: pickByHeaders(firstLine.rawData, ORDER_STATUS_HEADERS) || null,
        collectedAt: new Date(),
      })

      for (const line of group) {
        const normalized = normalizeImportedOrderItem(line.parsedData, line.marketplaceId)
        itemRows.push({
          orderId,
          marketplaceItemId: normalized.marketplaceItemId ?? null,
          productName: normalized.productName,
          optionText: normalized.optionText ?? null,
          quantity: normalized.quantity,
          unitPrice: String(normalized.totalAmount / Math.max(1, normalized.quantity)),
          sku: normalized.sku ?? null,
          lockedSku: normalized.sku ?? null,
          lockedProductName: normalized.productName,
          lockedOptionName: normalized.optionText ?? null,
          lockedQuantity: normalized.quantity,
          lockedAt: new Date(),
        })
        lineUpdates.push({ lineId: line.id, orderId })
        confirmed += 1
      }
    }

    for (const chunk of chunks(orderRows, 500)) {
      await tx.insert(orders).values(chunk)
    }

    for (const chunk of chunks(itemRows, 500)) {
      await tx.insert(orderItems).values(chunk)
    }

    for (const chunk of chunks(lineUpdates, 500)) {
      await tx.execute(sql`
        UPDATE sabangnet_review_lines AS line
        SET confirmed_order_id = updates.order_id,
            confirmed_at = NOW(),
            review_status = 'confirmed',
            updated_at = NOW()
        FROM (
          VALUES ${sql.join(chunk.map((row) => sql`(${row.lineId}::uuid, ${row.orderId}::uuid)`), sql`, `)}
        ) AS updates(line_id, order_id)
        WHERE line.id = updates.line_id
          AND line.user_id = ${userId}
      `)
    }

    await tx.execute(sql`
      UPDATE sabangnet_review_batches b
      SET confirmed_rows = (
            SELECT COUNT(*) FROM sabangnet_review_lines l
            WHERE l.batch_id = b.id AND l.review_status = 'confirmed'
          ),
          ready_rows = (
            SELECT COUNT(*) FROM sabangnet_review_lines l
            WHERE l.batch_id = b.id AND l.review_status = 'ready'
          ),
          blocked_rows = (
            SELECT COUNT(*) FROM sabangnet_review_lines l
            WHERE l.batch_id = b.id AND l.review_status = 'blocked'
          ),
          updated_at = NOW()
      WHERE b.id = ${batchId}::uuid AND b.user_id = ${userId}
    `)
  })

  const [counts] = resultRows(await db.execute<{
    readyRows: string | number
    blockedRows: string | number
    confirmedRows: string | number
    excludedRows: string | number
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE review_status = 'ready') AS "readyRows",
      COUNT(*) FILTER (WHERE review_status = 'blocked') AS "blockedRows",
      COUNT(*) FILTER (WHERE review_status = 'confirmed') AS "confirmedRows",
      COUNT(*) FILTER (WHERE review_status = 'excluded') AS "excludedRows"
    FROM sabangnet_review_lines
    WHERE user_id = ${userId}
      AND batch_id = ${batchId}::uuid
  `))

  const readyRows = Number(counts?.readyRows ?? 0)
  return {
    confirmed,
    excluded,
    readyRows,
    blockedRows: Number(counts?.blockedRows ?? 0),
    confirmedRows: Number(counts?.confirmedRows ?? 0),
    excludedRows: Number(counts?.excludedRows ?? 0),
    done: readyRows === 0,
  }
}

async function getMarketplaceConnections(userId: string): Promise<MarketplaceConnectionForReview[]> {
  return db
    .select({
      id: marketplaceConnections.id,
      marketplaceId: marketplaceConnections.marketplaceId,
      displayName: marketplaceConnections.displayName,
      metadata: marketplaceConnections.metadata,
    })
    .from(marketplaceConnections)
    .where(sql`${marketplaceConnections.userId} = ${userId}`)
}

async function refreshSabangnetReviewBatchCounts(
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
  batchId: string,
  userId: string,
) {
  await tx.execute(sql`
    UPDATE sabangnet_review_batches b
    SET total_rows = (
          SELECT COUNT(*) FROM sabangnet_review_lines l
          WHERE l.batch_id = b.id
        ),
        confirmed_rows = (
          SELECT COUNT(*) FROM sabangnet_review_lines l
          WHERE l.batch_id = b.id AND l.review_status = 'confirmed'
        ),
        ready_rows = (
          SELECT COUNT(*) FROM sabangnet_review_lines l
          WHERE l.batch_id = b.id AND l.review_status = 'ready'
        ),
        blocked_rows = (
          SELECT COUNT(*) FROM sabangnet_review_lines l
          WHERE l.batch_id = b.id AND l.review_status = 'blocked'
        ),
        updated_at = NOW()
    WHERE b.id = ${batchId}::uuid AND b.user_id = ${userId}
  `)
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getSabangnetOrderNumber(row: RawExcelRow): string {
  return pickByHeaders(row, ['사방넷 주문번호', '사방넷주문번호'])
}

function cleanOptionalString(value: unknown): string | undefined {
  const cleaned = cleanString(value)
  return cleaned || undefined
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return fallback
  return Math.trunc(num)
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return fallback
  return num
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
    const rowValues = sheet.getRow(rowNumber).values
    const values = Array.isArray(rowValues) ? rowValues : []
    const text = values.map((value) => cellText(value as ExcelJS.CellValue)).join('|')
    const score = ['주문번호', '쇼핑몰', '상품', '수량', '금액', '상태'].reduce(
      (sum, key) => sum + (text.includes(key) ? 1 : 0),
      0,
    )
    if (score > bestScore) {
      best = rowNumber
      bestScore = score
    }
  }
  return best
}

function buildReviewLine(input: {
  row: ParsedOrderRow
  normalized: ParsedOrderRow
  raw: RawExcelRow
  rowNumber: number
  duplicateInFile: boolean
  connection?: MarketplaceConnectionForReview | null
  skuSet: Set<string>
  existingSet: Set<string>
  marketplaceName: string
}) {
  const issueCodes: SabangnetReviewIssueCode[] = []
  const issueMessages: string[] = []
  const sku = input.normalized.sku?.trim() || null
  const marketplaceId = input.connection?.marketplaceId ?? null
  const existingOrder = marketplaceId ? input.existingSet.has(`${marketplaceId}:${input.row.orderNumber}`) : false
  const orderStatusText = pickByHeaders(input.raw, ORDER_STATUS_HEADERS)
  const claimType = claimTypeFromText(orderStatusText)

  pushIssue(!marketplaceId, 'marketplace_unmatched', '마켓명/마켓 ID 매칭 실패')
  pushIssue(input.duplicateInFile, 'duplicate_in_file', '파일 내 주문번호 중복')
  pushIssue(existingOrder, 'existing_order', '이미 등록된 기존 주문')
  pushIssue(!sku || !input.skuSet.has(sku), 'sku_unmatched', '내부상품코드(SKU) 매칭 실패')
  pushIssue(!Number.isFinite(input.row.quantity) || input.row.quantity <= 0, 'quantity_invalid', '수량 오류')
  pushIssue(!Number.isFinite(input.row.totalAmount) || input.row.totalAmount < 0, 'amount_invalid', '금액 오류')
  pushIssue(
    input.row.shippingFee != null && (!Number.isFinite(input.row.shippingFee) || input.row.shippingFee < 0),
    'shipping_fee_invalid',
    '배송비 오류',
  )
  return {
    rowNumber: input.rowNumber,
    orderNumber: input.row.orderNumber,
    marketplaceName: input.marketplaceName || null,
    marketplaceId,
    marketplaceMatched: Boolean(marketplaceId),
    existingOrder,
    duplicateInFile: input.duplicateInFile,
    sku,
    skuMatched: Boolean(sku && input.skuSet.has(sku)),
    quantity: input.row.quantity,
    totalAmount: input.row.totalAmount,
    shippingFee: input.row.shippingFee ?? null,
    orderStatusText: orderStatusText || null,
    claimType,
    reviewStatus: issueCodes.length === 0 ? 'ready' as const : 'blocked' as const,
    issueCodes,
    issueMessages,
    parsed: input.normalized,
    raw: input.raw,
  }

  function pushIssue(condition: boolean, code: SabangnetReviewIssueCode, message: string) {
    if (!condition) return
    issueCodes.push(code)
    issueMessages.push(message)
  }
}

function matchMarketplaceConnection(
  connections: MarketplaceConnectionForReview[],
  marketplaceName: string,
  fallbackMarketplaceId?: string,
) {
  if (fallbackMarketplaceId) {
    const exact = connections.find((connection) => connection.marketplaceId === fallbackMarketplaceId)
    if (exact) return exact
  }

  const target = normalizeKey(marketplaceName)
  if (!target) return null
  const connection = connections.find((connection) => {
    const names = [
      connection.marketplaceId,
      connection.displayName,
      String(connection.metadata?.systemMarketplaceName ?? ''),
      String(connection.metadata?.salesDisplayName ?? ''),
      String(connection.metadata?.salesExportMarketplaceId ?? ''),
      String(connection.metadata?.salesExportId ?? ''),
    ]
    return names.some((name) => {
      const key = normalizeKey(name)
      return key && (target.includes(key) || key.includes(target))
    })
  }) ?? null
  if (connection) return connection

  const knownMarketplace = KNOWN_MARKETPLACE_ALIASES.find((marketplace) => (
    marketplace.aliases.some((alias) => {
      const key = normalizeKey(alias)
      return key && (target.includes(key) || key.includes(target))
    })
  ))

  return knownMarketplace
    ? {
        id: null,
        marketplaceId: knownMarketplace.marketplaceId,
        displayName: knownMarketplace.displayName,
        metadata: null,
      }
    : null
}

function claimTypeFromText(value: string): string | null {
  const text = value.replace(/\s+/g, '')
  if (!text) return null
  if (text.includes('취소')) return 'cancel'
  if (text.includes('반품')) return 'return'
  if (text.includes('교환')) return 'exchange'
  return null
}

function claimLabel(value: string | null) {
  if (value === 'cancel') return '취소'
  if (value === 'return') return '반품'
  if (value === 'exchange') return '교환'
  return '클레임'
}

function pickByHeaders(row: RawExcelRow, candidates: string[]) {
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeKey(key)
    if (candidates.some((candidate) => normalized.includes(normalizeKey(candidate)))) {
      return value?.trim() ?? ''
    }
  }
  return ''
}

function getDuplicateLineKey(row: ParsedOrderRow, raw: RawExcelRow) {
  return [
    getSabangnetOrderNumber(raw) || row.orderNumber,
    row.marketplaceItemId,
    row.sku,
    row.productName,
    row.optionText,
  ].map((value) => normalizeKey(String(value ?? ''))).join(':')
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9가-힣]/g, '')
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

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function resultRows<T>(result: T[] | { rows?: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows ?? []
}
