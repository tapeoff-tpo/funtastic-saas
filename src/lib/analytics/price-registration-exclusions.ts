import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export function priceRegistrationProductKey(row: { productCode: string | null; productName: string | null; registeredProductName: string | null }) {
  const code = row.productCode?.trim()
  const name = (row.productName || row.registeredProductName)?.trim()
  if (code) return `code:${code}`
  return name ? `name:${name}` : null
}

let schemaReady: Promise<unknown> | undefined

function ensureSchema() {
  schemaReady ??= db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('analytics_price_registration_exclusions_schema'))`)
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS analytics_price_registration_exclusions (
        user_id uuid NOT NULL,
        product_key text NOT NULL,
        PRIMARY KEY (user_id, product_key)
      )
    `)
  }).catch((error: unknown) => {
    schemaReady = undefined
    throw error
  })
  return schemaReady
}

export async function listPriceRegistrationExclusions(userId: string) {
  await ensureSchema()
  const rows = await db.execute<{ product_key: string }>(sql`
    SELECT product_key FROM analytics_price_registration_exclusions WHERE user_id = ${userId}::uuid
  `)
  return new Set(rows.map((row) => row.product_key))
}

export async function savePriceRegistrationExclusion(userId: string, productKey: string, excluded: boolean) {
  await ensureSchema()
  if (excluded) {
    await db.execute(sql`
      INSERT INTO analytics_price_registration_exclusions (user_id, product_key)
      VALUES (${userId}::uuid, ${productKey})
      ON CONFLICT DO NOTHING
    `)
  } else {
    await db.execute(sql`
      DELETE FROM analytics_price_registration_exclusions
      WHERE user_id = ${userId}::uuid AND product_key = ${productKey}
    `)
  }
}
