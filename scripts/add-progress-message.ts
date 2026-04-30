/**
 * One-off migration: add progress_message text column to job_logs.
 *
 * Run with: npm run --prefix /Users/tapeoff/funtastic-saas exec -- \
 *   node --env-file=.env.local --import tsx scripts/add-progress-message.ts
 */
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL not set')

const sql = postgres(url, { ssl: 'require', prepare: false })

async function main() {
  await sql`ALTER TABLE job_logs ADD COLUMN IF NOT EXISTS progress_message text`
  console.log('OK: added job_logs.progress_message')
  await sql.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
