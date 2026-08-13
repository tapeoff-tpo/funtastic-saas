import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { parseChannelSalesWorkbook, type ParsedChannelSalesRow } from './channel-sales-parser'

export const CHANNEL_SALES_CHANNELS = ['rocket', 'bulk'] as const
export type ChannelSalesChannel = typeof CHANNEL_SALES_CHANNELS[number]

export type ChannelSalesBatch = {
  id: string
  channel: ChannelSalesChannel
  sourceFileName: string
  totalRows: number
  validRows: number
  invalidRows: number
  totalQuantity: number
  totalSales: number
  totalProfit: number | null
  periodStart: string | null
  periodEnd: string | null
  createdAt: Date
}

export type ChannelSalesAggregate = {
  channel: ChannelSalesChannel
  sales: number
  productCost: number
  marketplaceFee: number
  paidShippingFee: number
  actualShippingFee: number
  boxCost: number
  finalProfit: number
}

type AggregateQueryRow = {
  channel: ChannelSalesChannel
  sales: string | number | null
  productCost: string | number | null
  marketplaceFee: string | number | null
  paidShippingFee: string | number | null
  actualShippingFee: string | number | null
  boxCost: string | number | null
  finalProfit: string | number | null
}

const TABLE_SQL = sql`
  CREATE TABLE IF NOT EXISTS channel_sales_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    channel varchar(20) NOT NULL CHECK (channel IN ('rocket', 'bulk')),
    source_file_name varchar(255) NOT NULL,
    file_hash varchar(64) NOT NULL,
    total_rows integer NOT NULL DEFAULT 0,
    valid_rows integer NOT NULL DEFAULT 0,
    invalid_rows integer NOT NULL DEFAULT 0,
    total_quantity integer NOT NULL DEFAULT 0,
    total_sales numeric(16, 4) NOT NULL DEFAULT 0,
    total_profit numeric(16, 4),
    period_start date,
    period_end date,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, channel, file_hash)
  );

  CREATE TABLE IF NOT EXISTS channel_sales_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES channel_sales_batches(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    channel varchar(20) NOT NULL CHECK (channel IN ('rocket', 'bulk')),
    row_number integer NOT NULL,
    occurred_on date NOT NULL,
    source_sku varchar(200),
    product_name text,
    option_text text,
    counterparty text,
    quantity integer NOT NULL,
    unit_sale_price numeric(16, 4),
    sales_amount numeric(16, 4) NOT NULL,
    product_cost numeric(16, 4),
    marketplace_fee numeric(16, 4),
    paid_shipping_fee numeric(16, 4),
    actual_shipping_fee numeric(16, 4),
    box_cost numeric(16, 4),
    profit_amount numeric(16, 4),
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS channel_sales_batches_user_created_idx
    ON channel_sales_batches(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS channel_sales_lines_user_date_channel_idx
    ON channel_sales_lines(user_id, occurred_on, channel);
  CREATE INDEX IF NOT EXISTS channel_sales_lines_user_sku_date_idx
    ON channel_sales_lines(user_id, source_sku, occurred_on);
`

let ensureTablesPromise: Promise<void> | null = null

export function isChannelSalesChannel(value: string): value is ChannelSalesChannel {
  return CHANNEL_SALES_CHANNELS.includes(value as ChannelSalesChannel)
}

export function channelSalesLabel(channel: ChannelSalesChannel) {
  return channel === 'rocket' ? '로켓배송' : '대량'
}

export function ensureChannelSalesTables() {
  if (!ensureTablesPromise) {
    ensureTablesPromise = db.execute(sql`
      SELECT EXISTS(
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'channel_sales_batches'
      ) AS "exists"
    `)
      .then((result) => Boolean(resultRows<{ exists: boolean }>(result)[0]?.exists))
      .then((exists) => exists ? undefined : db.execute(TABLE_SQL).then(async () => {
        await db.execute(sql`ALTER TABLE channel_sales_batches ENABLE ROW LEVEL SECURITY`)
        await db.execute(sql`ALTER TABLE channel_sales_lines ENABLE ROW LEVEL SECURITY`)
      }))
      .then(() => undefined)
      .catch((error) => {
        ensureTablesPromise = null
        throw error
      })
  }
  return ensureTablesPromise
}

export async function importChannelSalesBatch(input: {
  userId: string
  channel: ChannelSalesChannel
  fileName: string
  fileBuffer: ArrayBuffer
}) {
  const parsed = await parseChannelSalesWorkbook(input.fileBuffer)
  await ensureChannelSalesTables()

  const fileHash = createHash('sha256').update(Buffer.from(input.fileBuffer)).digest('hex')
  const [existing] = resultRows<{ id: string }>(await db.execute(sql`
    SELECT id
    FROM channel_sales_batches
    WHERE user_id = ${input.userId}::uuid
      AND channel = ${input.channel}
      AND file_hash = ${fileHash}
    LIMIT 1
  `))
  if (existing) {
    return {
      batchId: existing.id,
      skipped: true,
      totalRows: parsed.totalRows,
      validRows: parsed.validRows.length,
      invalidRows: parsed.invalidRows,
      totalQuantity: 0,
      totalSales: 0,
      totalProfit: null,
      warnings: parsed.warnings,
    }
  }

  const dates = parsed.validRows.map((row) => row.occurredOn!).sort()
  const totalQuantity = parsed.validRows.reduce((sum, row) => sum + (row.quantity ?? 0), 0)
  const totalSales = parsed.validRows.reduce((sum, row) => sum + (row.salesAmount ?? 0), 0)
  const totalProfit = parsed.validRows.some((row) => row.profitAmount != null)
    ? parsed.validRows.reduce((sum, row) => sum + (row.profitAmount ?? calculatedProfit(row)), 0)
    : null
  const [batch] = resultRows<{ id: string }>(await db.execute(sql`
    INSERT INTO channel_sales_batches (
      user_id, channel, source_file_name, file_hash, total_rows, valid_rows, invalid_rows,
      total_quantity, total_sales, total_profit, period_start, period_end
    ) VALUES (
      ${input.userId}::uuid, ${input.channel}, ${input.fileName}, ${fileHash}, ${parsed.totalRows}, ${parsed.validRows.length}, ${parsed.invalidRows},
      ${totalQuantity}, ${totalSales}, ${totalProfit}, ${dates[0] ?? null}, ${dates.at(-1) ?? null}
    )
    RETURNING id
  `))

  for (const chunk of chunks(parsed.validRows, 300)) {
    await db.execute(sql`
      INSERT INTO channel_sales_lines (
        batch_id, user_id, channel, row_number, occurred_on, source_sku, product_name, option_text,
        counterparty, quantity, unit_sale_price, sales_amount, product_cost, marketplace_fee,
        paid_shipping_fee, actual_shipping_fee, box_cost, profit_amount, raw_data
      ) VALUES ${sql.join(chunk.map((row) => sql`(
        ${batch.id}::uuid,
        ${input.userId}::uuid,
        ${input.channel},
        ${row.rowNumber},
        ${row.occurredOn},
        ${row.sourceSku},
        ${row.productName},
        ${row.optionText},
        ${row.counterparty},
        ${row.quantity},
        ${row.unitSalePrice},
        ${row.salesAmount},
        ${row.productCost},
        ${row.marketplaceFee},
        ${row.paidShippingFee},
        ${row.actualShippingFee},
        ${row.boxCost},
        ${row.profitAmount},
        ${JSON.stringify(row.rawData)}::jsonb
      )`), sql`, `)}
    `)
  }

  return {
    batchId: batch.id,
    skipped: false,
    totalRows: parsed.totalRows,
    validRows: parsed.validRows.length,
    invalidRows: parsed.invalidRows,
    totalQuantity,
    totalSales,
    totalProfit,
    warnings: parsed.warnings,
  }
}

export async function listChannelSalesBatches(userId: string): Promise<ChannelSalesBatch[]> {
  await ensureChannelSalesTables()
  const rows = resultRows<ChannelSalesBatch>(await db.execute(sql`
    SELECT
      id,
      channel,
      source_file_name AS "sourceFileName",
      total_rows AS "totalRows",
      valid_rows AS "validRows",
      invalid_rows AS "invalidRows",
      total_quantity AS "totalQuantity",
      total_sales AS "totalSales",
      total_profit AS "totalProfit",
      period_start::text AS "periodStart",
      period_end::text AS "periodEnd",
      created_at AS "createdAt"
    FROM channel_sales_batches
    WHERE user_id = ${userId}::uuid
    ORDER BY created_at DESC
  `))
  return rows.map((row) => ({
    ...row,
    totalQuantity: toNumber(row.totalQuantity),
    totalSales: toNumber(row.totalSales),
    totalProfit: row.totalProfit == null ? null : toNumber(row.totalProfit),
  }))
}

export async function getChannelSalesAggregates(input: {
  userId: string
  start: string
  end: string
}): Promise<ChannelSalesAggregate[]> {
  await ensureChannelSalesTables()
  const rows = resultRows<AggregateQueryRow>(await db.execute(sql`
    SELECT
      channel,
      COALESCE(SUM(sales_amount), 0)::text AS sales,
      COALESCE(SUM(product_cost), 0)::text AS "productCost",
      COALESCE(SUM(marketplace_fee), 0)::text AS "marketplaceFee",
      COALESCE(SUM(paid_shipping_fee), 0)::text AS "paidShippingFee",
      COALESCE(SUM(actual_shipping_fee), 0)::text AS "actualShippingFee",
      COALESCE(SUM(box_cost), 0)::text AS "boxCost",
      COALESCE(SUM(
        COALESCE(
          profit_amount,
          sales_amount
            - COALESCE(product_cost, 0)
            - COALESCE(marketplace_fee, 0)
            + COALESCE(paid_shipping_fee, 0)
            - COALESCE(actual_shipping_fee, 0)
            - COALESCE(box_cost, 0)
        )
      ), 0)::text AS "finalProfit"
    FROM channel_sales_lines
    WHERE user_id = ${input.userId}::uuid
      AND occurred_on >= ${input.start}::date
      AND occurred_on < ${input.end}::date
    GROUP BY channel
    ORDER BY channel
  `))
  return rows.map((row) => ({
    channel: row.channel,
    sales: toNumber(row.sales),
    productCost: toNumber(row.productCost),
    marketplaceFee: toNumber(row.marketplaceFee),
    paidShippingFee: toNumber(row.paidShippingFee),
    actualShippingFee: toNumber(row.actualShippingFee),
    boxCost: toNumber(row.boxCost),
    finalProfit: toNumber(row.finalProfit),
  }))
}

function calculatedProfit(row: ParsedChannelSalesRow) {
  return (row.salesAmount ?? 0)
    - (row.productCost ?? 0)
    - (row.marketplaceFee ?? 0)
    + (row.paidShippingFee ?? 0)
    - (row.actualShippingFee ?? 0)
    - (row.boxCost ?? 0)
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: T[] }).rows
  }
  return []
}

function toNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
