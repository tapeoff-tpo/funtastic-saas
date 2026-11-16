import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
try {
  for (const migration of ['0061_quote_sales.sql', '0062_quote_clients.sql']) {
    await sql.unsafe(await readFile(new URL(`../src/lib/db/migrations/${migration}`, import.meta.url), 'utf8'))
  }
  const rows = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('quote_clients', 'quote_sales', 'quote_sale_items', 'quote_sale_attachments', 'quotes', 'quote_items')
  `
  const references = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('quote_sales', 'quotes')
      AND column_name IN ('client_id', 'customer_id')
  `
  if (rows.length !== 6 || references.length !== 4) {
    throw new Error('영업·견적서·거래처 공용 데이터 스키마를 확인해주세요.')
  }
  console.log('영업관리·견적서·거래처 공용 데이터 스키마 준비 완료.')
} finally {
  await sql.end()
}
