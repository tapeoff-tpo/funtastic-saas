/** Copies new-product binaries to R2 and records object keys. It intentionally retains DB bytes.
 * Run: node --env-file=.env.local --import tsx scripts/migrate-new-product-files-to-r2.mts
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import postgres from 'postgres'
const require = createRequire(import.meta.url)
const { newProductObjectKey, putR2Object } = require('../src/lib/storage/r2.ts') as typeof import('../src/lib/storage/r2')

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

async function migrate(table: 'attachments' | 'works-assets') {
  const dbTable = table === 'attachments' ? 'new_product_workflow_attachments' : 'new_product_works_assets'
  const ids = await sql.unsafe(`SELECT id::text FROM ${dbTable} WHERE file_data IS NOT NULL AND object_key IS NULL ORDER BY created_at, id`)
  console.log(`${dbTable}: ${ids.length} files to copy`)
  for (let index = 0; index < ids.length; index += 1) {
    const [row] = await sql.unsafe(`SELECT id::text, user_id::text, content_type, file_data FROM ${dbTable} WHERE id = $1 AND object_key IS NULL`, [(ids[index] as unknown as { id: string }).id]) as unknown as Array<{ id: string; user_id: string; content_type: string; file_data: Uint8Array }>
    if (!row) continue
    const bytes = Buffer.from(row.file_data)
    const key = newProductObjectKey(row.user_id, table, row.id, sha(bytes))
    await putR2Object(key, bytes, row.content_type)
    const verified = await sql.unsafe(`SELECT octet_length(file_data) AS bytes FROM ${dbTable} WHERE id = $1 AND object_key IS NULL`, [row.id])
    if (!verified[0] || Number(verified[0].bytes) !== bytes.length) throw new Error(`${row.id}: DB source changed while copying`)
    await sql.unsafe(`UPDATE ${dbTable} SET object_key = $1 WHERE id = $2 AND object_key IS NULL`, [key, row.id])
    console.log(`${dbTable} ${index + 1}/${ids.length} ${row.id}`)
  }
}

try {
  await sql`ALTER TABLE new_product_workflow_attachments ADD COLUMN IF NOT EXISTS object_key text`
  await sql`ALTER TABLE new_product_workflow_attachments ALTER COLUMN file_data DROP NOT NULL`
  await sql`ALTER TABLE new_product_works_assets ADD COLUMN IF NOT EXISTS object_key text`
  await migrate('attachments')
  await migrate('works-assets')
  console.log('R2 copy complete. Database bytes are still retained until explicit cleanup.')
} finally { await sql.end() }
