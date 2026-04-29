/**
 * Migration 020 runner — phone2/매핑 audit/preparing_at + scan_logs 테이블.
 */
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL)

try {
  const sqlText = await readFile(
    new URL('../supabase/migrations/020_order_detail_extensions.sql', import.meta.url),
    'utf8',
  )
  await sql.unsafe(sqlText)

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'orders'
      AND column_name IN ('buyer_phone2','recipient_phone2','mapped_at','mapped_by_user_id','preparing_at')
  `
  const [{ exists }] = await sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scan_logs') AS exists
  `
  console.log(`OK — orders new columns: ${cols.map((c) => c.column_name).sort().join(', ')}`)
  console.log(`OK — scan_logs table: ${exists ? 'created' : 'MISSING'}`)
} catch (e) {
  console.error('ERR:', e)
  process.exit(1)
}
await sql.end()
