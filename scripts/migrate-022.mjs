/**
 * Migration 022 runner — 사방넷 매핑코드 3-table 시스템.
 */
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL)

try {
  const sqlText = await readFile(
    new URL('../supabase/migrations/022_mapping_codes_system.sql', import.meta.url),
    'utf8',
  )
  await sql.unsafe(sqlText)

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('mapping_codes','mapping_sources','mapping_components')
    ORDER BY table_name
  `
  console.log(`OK — created tables: ${tables.map((t) => t.table_name).join(', ')}`)

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename IN ('mapping_codes','mapping_sources','mapping_components')
      AND indexname LIKE 'mapping_%'
    ORDER BY indexname
  `
  console.log(`OK — indexes: ${idx.map((r) => r.indexname).join(', ')}`)
} catch (e) {
  console.error('ERR:', e)
  process.exit(1)
}
await sql.end()
