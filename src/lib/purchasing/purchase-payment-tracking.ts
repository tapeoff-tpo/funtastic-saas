import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

let ensureSchemaPromise: Promise<void> | null = null

export function ensurePurchasePaymentTrackingSchema() {
  ensureSchemaPromise ??= (async () => {
    await db.execute(sql`
      ALTER TABLE purchase_request_items
        ADD COLUMN IF NOT EXISTS payment_status varchar(30) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS payment_paid_at timestamp with time zone,
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
