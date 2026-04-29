/**
 * Migration 018 runner — orders.internal_no 추가 + 백필 + UNIQUE.
 */
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL)

try {
  const sqlText = await readFile(
    new URL('../supabase/migrations/018_orders_internal_no.sql', import.meta.url),
    'utf8',
  )
  await sql.unsafe(sqlText)
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM orders WHERE internal_no IS NOT NULL`
  console.log(`OK — internal_no backfilled rows: ${count}`)
} catch (e) {
  console.error('ERR:', e)
  process.exit(1)
}
await sql.end()
