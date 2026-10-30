import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
try {
  await sql.unsafe(await readFile(new URL('../supabase/migrations/20261030010000_purchase_inspection.sql', import.meta.url), 'utf8'))
  const [column] = await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'purchase_request_items' AND column_name = 'purchase_inspection'`
  const [status] = await sql`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'purchase_request_status' AND e.enumlabel = 'inspecting'`
  if (!column || !status) throw new Error('검수 단계 스키마 준비에 실패했습니다.')
  console.log('검수 단계·송장별 박스 기록 스키마 준비 완료. 기존 발주 데이터는 변경하지 않았습니다.')
} finally { await sql.end() }
