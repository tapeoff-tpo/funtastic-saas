import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL)

try {
  await sql`ALTER TABLE carrier_templates ALTER COLUMN carrier_id DROP NOT NULL`
  const cols = await sql`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name = 'carrier_templates' AND column_name = 'carrier_id'
  `
  console.log('carrier_id:', cols)
} catch (e) {
  console.error('ERR:', e)
  process.exit(1)
}
await sql.end()
