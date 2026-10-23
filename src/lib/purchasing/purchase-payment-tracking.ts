import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

let ensureSchemaPromise: Promise<void> | null = null

const PAYMENT_TRACKING_COLUMNS = [
  'payment_status',
  'payment_paid_at',
  'bulk_payment_pending',
  'bulk_payment_due_date',
  'bulk_payment_deposit_cny',
  'bulk_payment_deposit_krw',
  'bulk_payment_deposit_paid_at',
  'bulk_payment_deposit_memo',
  'cost_exchange_rate_krw',
  'cost_exchange_rate_date',
] as const

type PaymentTrackingSchemaRow = {
  columnCount: number | string
  hasIndex: boolean
}

function resultRows<T>(result: T[] | { rows?: T[] }) {
  return Array.isArray(result) ? result : result.rows ?? []
}

async function hasPaymentTrackingSchema() {
  const [row] = resultRows<PaymentTrackingSchemaRow>(await db.execute(sql`
    SELECT
      COUNT(*)::int AS "columnCount",
      to_regclass(current_schema() || '.purchase_request_items_user_payment_status') IS NOT NULL AS "hasIndex"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'purchase_request_items'
      AND column_name IN (${sql.join(PAYMENT_TRACKING_COLUMNS.map((column) => sql`${column}`), sql`, `)})
  `))
  return Number(row?.columnCount) === PAYMENT_TRACKING_COLUMNS.length && row?.hasIndex === true
}

export function ensurePurchasePaymentTrackingSchema() {
  ensureSchemaPromise ??= (async () => {
    // On serverless cold starts this used to run ALTER TABLE even after the
    // migration had completed. The DDL can briefly lock the purchase table.
    if (await hasPaymentTrackingSchema()) return

    await db.execute(sql`
      ALTER TABLE purchase_request_items
        ADD COLUMN IF NOT EXISTS payment_status varchar(30) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS payment_paid_at timestamp with time zone,
        ADD COLUMN IF NOT EXISTS bulk_payment_pending boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS bulk_payment_due_date date,
        ADD COLUMN IF NOT EXISTS bulk_payment_deposit_cny numeric(16, 2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bulk_payment_deposit_krw numeric(16, 2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS bulk_payment_deposit_paid_at date,
        ADD COLUMN IF NOT EXISTS bulk_payment_deposit_memo text,
        ADD COLUMN IF NOT EXISTS cost_exchange_rate_krw numeric(12, 4),
        ADD COLUMN IF NOT EXISTS cost_exchange_rate_date date
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS purchase_request_items_user_payment_status
      ON purchase_request_items(user_id, payment_status)
    `)
  })().catch((error) => {
    ensureSchemaPromise = null
    throw error
  })

  return ensureSchemaPromise
}
