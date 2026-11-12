import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
try {
  const [table] = await sql`SELECT to_regclass('public.outbound_reflection_lines') AS name`
  if (table?.name) {
    // Run outside a transaction so normal stock/outbound writes remain available.
    await sql.unsafe(await readFile(new URL('../supabase/migrations/20261109030000_inventory_outgoing_search_index.sql', import.meta.url), 'utf8'))
    const [index] = await sql`
      SELECT i.indisvalid FROM pg_index i
      WHERE i.indexrelid = to_regclass('public.outbound_reflection_applied_user_sku_date_idx')
    `
    if (!index?.indisvalid) throw new Error('재고 출고수량 조회 인덱스 준비에 실패했습니다.')
    console.log('재고 출고수량 조회 인덱스 준비 완료.')
  }
} finally {
  await sql.end()
}
