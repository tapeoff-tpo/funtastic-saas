import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL)

try {
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS logistics_message VARCHAR(200)`
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'logistics_message'
  `
  console.log('logistics_message column:', cols)
} catch (e) {
  console.error('ERR:', e)
  process.exit(1)
}
await sql.end()
