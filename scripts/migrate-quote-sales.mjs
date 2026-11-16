import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
try {
  await sql.unsafe(await readFile(new URL('../src/lib/db/migrations/0061_quote_sales.sql', import.meta.url), 'utf8'))
  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('quote_sales', 'quote_sale_items', 'quote_sale_attachments', 'quotes', 'quote_items')
  `
  const clientIds = await sql`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('quote_sales', 'quotes')
      AND column_name = 'client_id'
  `
  if (rows.length !== 5 || clientIds.length !== 2) {
    throw new Error('영업·견적서 공용 데이터 스키마를 확인해주세요.')
  }
  console.log('영업관리·견적서 공용 데이터 스키마 준비 완료.')
} finally {
  await sql.end()
}
