import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL)

try {
  await sql`
    CREATE TABLE IF NOT EXISTS order_memos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      content TEXT NOT NULL,
      memo_type VARCHAR(50) NOT NULL DEFAULT 'general',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS order_memos_order_id_created ON order_memos (order_id, created_at DESC)`
  const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = 'order_memos'`
  console.log('Table created. Rows:', rows)
} catch (e) {
  console.error('ERR:', e)
  process.exit(1)
}
await sql.end()
