import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products, productVariants } from '@/lib/db/schema'
import {
  parseCoupangRocketOutboundWorkbook,
  type ParsedCoupangRocketOutboundRow,
} from './coupang-rocket-outbound-parser'

export type CoupangRocketOutboundBatch = {
  id: string
  sourceFileName: string
  totalRows: number
  validRows: number
  matchedRows: number
  unmatchedRows: number
  invalidRows: number
  duplicateRows: number
  periodStart: string | null
  periodEnd: string | null
  createdAt: Date
}

export type CoupangRocketOutgoingMetrics = {
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
}

type MetricRow = CoupangRocketOutgoingMetrics & {
  internalSku: string
}

export type CoupangRocketOutboundSkuMatcher = {
  skuByCode: Map<string, string | null>
  skuByName: Map<string, string | null>
}

type ImportedRocketOutboundLine = {
  rowNumber: number
  sourceRowNumbers: number[]
  shipmentDate: string
  sourceOrderId: string
  sourceSku: string | null
  productName: string | null
  sku: string | null
  quantity: number
  sourceKey: string
  rawData: Record<string, unknown>
}

const TABLE_SQL = sql`
  CREATE TABLE IF NOT EXISTS coupang_rocket_outbound_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    source_file_name varchar(255) NOT NULL,
    file_hash varchar(64) NOT NULL,
    total_rows integer NOT NULL DEFAULT 0,
    valid_rows integer NOT NULL DEFAULT 0,
    matched_rows integer NOT NULL DEFAULT 0,
    unmatched_rows integer NOT NULL DEFAULT 0,
    invalid_rows integer NOT NULL DEFAULT 0,
    duplicate_rows integer NOT NULL DEFAULT 0,
    period_start date,
    period_end date,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, file_hash)
  );

  CREATE TABLE IF NOT EXISTS coupang_rocket_outbound_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES coupang_rocket_outbound_batches(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    row_number integer NOT NULL,
    source_row_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
    shipped_on date NOT NULL,
    source_order_id varchar(200) NOT NULL,
    source_sku varchar(200),
    sku varchar(100),
    product_name text,
    quantity integer NOT NULL,
    source_key varchar(64) NOT NULL,
    metric_included boolean NOT NULL DEFAULT false,
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS coupang_rocket_outbound_batches_user_created_idx
    ON coupang_rocket_outbound_batches(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS coupang_rocket_outbound_lines_user_metric_date_idx
    ON coupang_rocket_outbound_lines(user_id, metric_included, shipped_on);
  CREATE INDEX IF NOT EXISTS coupang_rocket_outbound_lines_user_sku_date_idx
    ON coupang_rocket_outbound_lines(user_id, sku, shipped_on);
  CREATE INDEX IF NOT EXISTS coupang_rocket_outbound_lines_user_source_key_idx
    ON coupang_rocket_outbound_lines(user_id, source_key);
`

let ensureTablesPromise: Promise<void> | null = null

export function ensureCoupangRocketOutboundTables() {
  if (!ensureTablesPromise) {
    ensureTablesPromise = db.execute(TABLE_SQL)
      .then(() => undefined)
      .catch((error) => {
        ensureTablesPromise = null
        throw error
      })
  }
  return ensureTablesPromise
}

export async function importCoupangRocketOutboundBatch(input: {
  userId: string
  fileName: string
  fileBuffer: ArrayBuffer
}) {
  const [parsed, matcher] = await Promise.all([
    parseCoupangRocketOutboundWorkbook(input.fileBuffer),
    getProductMatcher(input.userId),
  ])
  await ensureCoupangRocketOutboundTables()

  const fileHash = createHash('sha256').update(Buffer.from(input.fileBuffer)).digest('hex')
  const [existing] = resultRows<{ id: string }>(await db.execute(sql`
    SELECT id
    FROM coupang_rocket_outbound_batches
    WHERE user_id = ${input.userId}::uuid
      AND file_hash = ${fileHash}
    LIMIT 1
  `))
  if (existing) {
    return {
      batchId: existing.id,
      skipped: true,
      totalRows: parsed.totalRows,
      validRows: parsed.validRows.length,
      matchedRows: 0,
      unmatchedRows: 0,
      invalidRows: parsed.invalidRows,
      duplicateRows: 0,
      warnings: parsed.warnings,
    }
  }

  const prepared = mergeDuplicateSourceRows(parsed.validRows.map((row) => prepareImportedLine(row, matcher)))
  const matchedRows = parsed.validRows.filter((row) => matchCoupangRocketOutboundSku(row, matcher) !== null).length
  const unmatchedRows = parsed.validRows.length - matchedRows
  const duplicateRows = parsed.validRows.length - prepared.length
  const dates = prepared.map((line) => line.shipmentDate).sort()
  const periodStart = dates[0] ?? null
  const periodEnd = dates.at(-1) ?? null

  const [batch] = resultRows<{ id: string }>(await db.execute(sql`
    INSERT INTO coupang_rocket_outbound_batches (
      user_id, source_file_name, file_hash, total_rows, valid_rows,
      matched_rows, unmatched_rows, invalid_rows, duplicate_rows, period_start, period_end
    ) VALUES (
      ${input.userId}::uuid, ${input.fileName}, ${fileHash}, ${parsed.totalRows}, ${parsed.validRows.length},
      ${matchedRows}, ${unmatchedRows}, ${parsed.invalidRows}, ${duplicateRows}, ${periodStart}, ${periodEnd}
    )
    RETURNING id
  `))

  const activeSourceKeys = prepared
    .filter((line) => line.sku !== null)
    .map((line) => line.sourceKey)
  for (const chunk of chunks([...new Set(activeSourceKeys)], 500)) {
    await db.execute(sql`
      UPDATE coupang_rocket_outbound_lines
      SET metric_included = false
      WHERE user_id = ${input.userId}::uuid
        AND metric_included = true
        AND source_key IN (${sql.join(chunk.map((value) => sql`${value}`), sql`, `)})
    `)
  }

  for (const chunk of chunks(prepared, 400)) {
    await db.execute(sql`
      INSERT INTO coupang_rocket_outbound_lines (
        batch_id, user_id, row_number, source_row_numbers, shipped_on,
        source_order_id, source_sku, sku, product_name, quantity,
        source_key, metric_included, raw_data
      ) VALUES ${sql.join(chunk.map((line) => sql`(
        ${batch.id}::uuid,
        ${input.userId}::uuid,
        ${line.rowNumber},
        ${JSON.stringify(line.sourceRowNumbers)}::jsonb,
        ${line.shipmentDate},
        ${line.sourceOrderId},
        ${line.sourceSku},
        ${line.sku},
        ${line.productName},
        ${line.quantity},
        ${line.sourceKey},
        ${line.sku !== null},
        ${JSON.stringify(line.rawData)}::jsonb
      )`), sql`, `)}
    `)
  }

  return {
    batchId: batch.id,
    skipped: false,
    totalRows: parsed.totalRows,
    validRows: parsed.validRows.length,
    matchedRows,
    unmatchedRows,
    invalidRows: parsed.invalidRows,
    duplicateRows,
    warnings: parsed.warnings,
  }
}

export async function listCoupangRocketOutboundBatches(userId: string): Promise<CoupangRocketOutboundBatch[]> {
  await ensureCoupangRocketOutboundTables()
  return resultRows<CoupangRocketOutboundBatch>(await db.execute(sql`
    SELECT
      id,
      source_file_name AS "sourceFileName",
      total_rows AS "totalRows",
      valid_rows AS "validRows",
      matched_rows AS "matchedRows",
      unmatched_rows AS "unmatchedRows",
      invalid_rows AS "invalidRows",
      duplicate_rows AS "duplicateRows",
      period_start::text AS "periodStart",
      period_end::text AS "periodEnd",
      created_at AS "createdAt"
    FROM coupang_rocket_outbound_batches
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at DESC
  `))
}

export async function getCoupangRocketOutgoingMetrics(input: {
  userId: string
  skus: string[]
  previousThreeMonthDate: string
  currentMonthDate: string
  nextMonthDate: string
}): Promise<Map<string, CoupangRocketOutgoingMetrics>> {
  const skus = [...new Set(input.skus.filter(Boolean))]
  if (skus.length === 0) return new Map()
  await ensureCoupangRocketOutboundTables()

  const rows = resultRows<MetricRow>(await db.execute(sql`
    SELECT
      sku AS "internalSku",
      COALESCE(SUM(CASE
        WHEN shipped_on >= ${input.currentMonthDate}::date
         AND shipped_on < ${input.nextMonthDate}::date
        THEN quantity
        ELSE 0
      END), 0)::numeric AS "currentMonthOutgoing",
      (
        COALESCE(SUM(CASE
          WHEN shipped_on >= ${input.previousThreeMonthDate}::date
           AND shipped_on < ${input.currentMonthDate}::date
          THEN quantity
          ELSE 0
        END), 0) / 3.0
      )::numeric AS "threeMonthAverageOutgoing"
    FROM coupang_rocket_outbound_lines
    WHERE user_id = ${input.userId}::uuid
      AND metric_included = true
      AND sku IN (${sql.join(skus.map((sku) => sql`${sku}`), sql`, `)})
      AND shipped_on >= ${input.previousThreeMonthDate}::date
      AND shipped_on < ${input.nextMonthDate}::date
    GROUP BY sku
  `))

  return new Map(rows.map((row) => [
    row.internalSku,
    {
      currentMonthOutgoing: cleanMetricNumber(row.currentMonthOutgoing),
      threeMonthAverageOutgoing: cleanMetricNumber(row.threeMonthAverageOutgoing),
    },
  ]))
}

async function getProductMatcher(userId: string): Promise<CoupangRocketOutboundSkuMatcher> {
  const [productRows, variantRows] = await Promise.all([
    db.select({
      id: products.id,
      internalSku: products.internalSku,
      name: products.name,
      metadata: products.metadata,
    }).from(products).where(and(
      eq(products.userId, userId),
      sql`${products.status} <> 'deleted'`,
    )),
    db.select({
      variantSku: productVariants.sku,
    }).from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(
        eq(products.userId, userId),
        eq(productVariants.isActive, true),
        sql`${products.status} <> 'deleted'`,
      )),
  ])

  const skuByCode = new Map<string, string | null>()
  const skuByName = new Map<string, string | null>()
  for (const row of productRows) {
    addUniqueMatch(skuByCode, normalizeCode(row.internalSku), row.internalSku)
    addUniqueMatch(skuByCode, normalizeCode(readEsaValue(row.metadata, '품목코드')), row.internalSku)
    addUniqueMatch(skuByName, normalizeName(row.name), row.internalSku)
    addUniqueMatch(skuByName, normalizeName(readEsaValue(row.metadata, '품목명')), row.internalSku)
  }
  for (const row of variantRows) {
    addUniqueMatch(skuByCode, normalizeCode(row.variantSku), row.variantSku)
  }
  return { skuByCode, skuByName }
}

function prepareImportedLine(row: ParsedCoupangRocketOutboundRow, matcher: CoupangRocketOutboundSkuMatcher): ImportedRocketOutboundLine {
  const sourceOrderId = row.sourceOrderId ?? `row:${row.rowNumber}`
  const identity = row.sourceSku ?? row.productName ?? `row:${row.rowNumber}`
  return {
    rowNumber: row.rowNumber,
    sourceRowNumbers: [row.rowNumber],
    shipmentDate: row.shipmentDate!,
    sourceOrderId,
    sourceSku: row.sourceSku,
    productName: row.productName,
    sku: matchCoupangRocketOutboundSku(row, matcher),
    quantity: row.quantity!,
    sourceKey: createSourceKey(row.shipmentDate!, sourceOrderId, identity),
    rawData: row.rawData,
  }
}

function mergeDuplicateSourceRows(lines: ImportedRocketOutboundLine[]) {
  const merged = new Map<string, ImportedRocketOutboundLine>()
  for (const line of lines) {
    const current = merged.get(line.sourceKey)
    if (!current) {
      merged.set(line.sourceKey, line)
      continue
    }
    current.quantity += line.quantity
    current.sourceRowNumbers.push(...line.sourceRowNumbers)
    current.rawData = {
      ...current.rawData,
      mergedSourceRowNumbers: current.sourceRowNumbers,
    }
  }
  return [...merged.values()]
}

export function matchCoupangRocketOutboundSku(
  row: Pick<ParsedCoupangRocketOutboundRow, 'sourceSku' | 'productName'>,
  matcher: CoupangRocketOutboundSkuMatcher,
) {
  const sourceSku = normalizeCode(row.sourceSku)
  if (sourceSku) return matcher.skuByCode.get(sourceSku) ?? null
  return matcher.skuByName.get(normalizeName(row.productName)) ?? null
}

function createSourceKey(shipmentDate: string, sourceOrderId: string, identity: string) {
  return createHash('sha256')
    .update(`${shipmentDate}\u001f${sourceOrderId}\u001f${identity}`)
    .digest('hex')
}

function readEsaValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object') return null
  const esa = (metadata as Record<string, unknown>).esa009m
  if (!esa || typeof esa !== 'object') return null
  const value = (esa as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

function addUniqueMatch(map: Map<string, string | null>, key: string, sku: string) {
  if (!key) return
  const current = map.get(key)
  if (current === undefined) {
    map.set(key, sku)
  } else if (current !== sku) {
    map.set(key, null)
  }
}

function normalizeCode(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

function normalizeName(value: string | null | undefined) {
  return (value ?? '').trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ')
}

function cleanMetricNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.round(number * 10) / 10)
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: T[] }).rows
  }
  return []
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
