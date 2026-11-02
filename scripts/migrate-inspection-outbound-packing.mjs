import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
try {
  await sql.unsafe(await readFile(new URL('../supabase/migrations/20261102000000_inspection_outbound_packing.sql', import.meta.url), 'utf8'))
  const [column] = await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'saas_china_shipment_purchase_allocations' AND column_name = 'inspection_boxes'`
  if (!column) throw new Error('검수·출고 박스 연결 스키마를 확인해주세요.')
  console.log('검수·출고 박스 연결 준비 완료. 기존 출고 포장은 변경하지 않았습니다.')
} finally { await sql.end() }
