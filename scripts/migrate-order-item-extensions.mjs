/**
 * Applies the idempotent order_items column migrations required by current
 * collection and shipment-locking code.
 */
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL)

try {
  for (const migration of [
    '010_mapping_quantity.sql',
    '027_lock_shipped_order_items.sql',
  ]) {
    const sqlText = await readFile(
      new URL(`../supabase/migrations/${migration}`, import.meta.url),
      'utf8',
    )
    await sql.unsafe(sqlText)
    console.log(`OK - applied ${migration}`)
  }

  const requiredColumns = [
    'sku_multiplier',
    'fulfillment_code',
    'locked_sku',
    'locked_product_name',
    'locked_option_name',
    'locked_quantity',
    'locked_mapping_code_id',
    'locked_mapping_code',
    'locked_at',
    'locked_by_user_id',
  ]
  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_items'
      AND column_name = ANY(${requiredColumns})
  `
  const found = new Set(rows.map((row) => row.column_name))
  const missing = requiredColumns.filter((column) => !found.has(column))
  if (missing.length > 0) {
    throw new Error(`order_items columns missing after migration: ${missing.join(', ')}`)
  }

  console.log(`OK - order_items columns verified: ${requiredColumns.join(', ')}`)
} catch (error) {
  console.error('ERR:', error)
  process.exitCode = 1
} finally {
  await sql.end()
}
