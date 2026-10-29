/** Import a reviewed SKU/name manifest without replacing existing names or other item data.
 * Usage: node --env-file=<env> scripts/import-chinese-product-names.mjs
 *   --input <manifest.json> --report <report.json> [--apply]
 */
import fs from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import postgres from 'postgres'

const args = process.argv.slice(2)
const argument = (name) => args[args.indexOf(name) + 1]
if (!args.includes('--input') || !args.includes('--report')) throw new Error('--input and --report are required')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const manifest = JSON.parse(await fs.readFile(argument('--input'), 'utf8'))
if (!Array.isArray(manifest.items) || !manifest.items.length) throw new Error('Manifest items are required')
const seen = new Set()
for (const item of manifest.items) {
  if (typeof item.sku !== 'string' || item.sku !== item.sku.trim() || !item.sku || seen.has(item.sku)) throw new Error('Each SKU must be unique and nonblank')
  if (typeof item.chineseName !== 'string' || !item.chineseName.trim() || item.chineseName.length > 1000 || !Array.isArray(item.sources) || !item.sources.length) throw new Error(`Invalid name or source: ${item.sku}`)
  seen.add(item.sku)
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
const reportPath = argument('--report')
const apply = args.includes('--apply')
try {
  const report = await sql.begin(async (tx) => {
    // Preserve the same canonical-owner and legacy source-owner precedence as getWorkspaceUserId.
    const canonical = await tx`select id from user_profiles where deactivated_at is null and (email ilike 'admin123%' or display_name ilike 'admin123%') order by created_at limit 1`
    let ownerId = canonical[0]?.id
    if (!ownerId) {
      const connections = await tx`select user_id as id from marketplace_connections order by created_at limit 1`
      const orders = await tx`select user_id as id from orders order by created_at limit 1`
      const products = await tx`select user_id as id from products order by created_at limit 1`
      ownerId = connections[0]?.id ?? orders[0]?.id ?? products[0]?.id
    }
    if (!ownerId || manifest.ownerId !== ownerId) throw new Error('Manifest workspace does not match the operational owner')
    const rows = await tx`select id, internal_sku as sku, name, metadata from products where user_id = ${ownerId} and internal_sku in ${tx([...seen])}`
    const bySku = new Map(rows.map((row) => [row.sku, row]))
    if (bySku.size !== rows.length) throw new Error('Duplicate database SKU; import aborted')
    const ready = [], unchanged = [], conflicts = [], unmatched = []
    for (const item of manifest.items) {
      const row = bySku.get(item.sku)
      if (!row) { unmatched.push(item); continue }
      const existing = row.metadata?.chineseProductName
      if (existing === item.chineseName) { unchanged.push(item.sku); continue }
      if ((row.metadata !== null && (typeof row.metadata !== 'object' || Array.isArray(row.metadata))) || (existing != null && (typeof existing !== 'string' || existing.trim()))) {
        conflicts.push({ sku: item.sku, existing, proposed: item.chineseName }); continue
      }
      ready.push(item)
    }
    const result = { applied: apply, ready: ready.length, updated: 0, unchanged, conflicts, unmatched, items: ready.map((item) => ({ ...item, koreanName: bySku.get(item.sku).name })) }
    if (apply && ready.length) {
      // Save the affected original records before changing anything. Never put credentials in reports.
      await fs.writeFile(`${reportPath}.backup.json`, JSON.stringify({ ownerId, items: ready.map((item) => bySku.get(item.sku)) }, null, 2))
      const importedAt = new Date().toISOString()
      const payload = ready.map((item) => ({ sku: item.sku, chinese_name: item.chineseName, source: { files: item.sources, resolution: item.resolution ?? 'Exact SKU from supplied filename and consistent label text', importedAt } }))
      const updated = await tx`
        update products p
        set metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('chineseProductName', i.chinese_name, 'chineseProductNameSource', i.source), updated_at = now()
        from jsonb_to_recordset(${tx.json(payload)}::jsonb) as i(sku text, chinese_name text, source jsonb)
        where p.user_id = ${ownerId} and p.internal_sku = i.sku
          and (p.metadata is null or jsonb_typeof(p.metadata) = 'object')
          and coalesce(btrim(p.metadata->>'chineseProductName'), '') = ''
        returning p.internal_sku as sku, p.metadata
      `
      if (updated.length !== ready.length) throw new Error('Items changed during import; transaction rolled back')
      const intended = new Map(ready.map((item) => [item.sku, item.chineseName]))
      for (const row of updated) {
        const { chineseProductName, chineseProductNameSource, ...rest } = row.metadata
        const original = { ...(bySku.get(row.sku).metadata ?? {}) }
        delete original.chineseProductName
        delete original.chineseProductNameSource
        if (chineseProductName !== intended.get(row.sku) || !chineseProductNameSource || !isDeepStrictEqual(rest, original)) throw new Error(`Verification failed; transaction rolled back: ${row.sku}`)
      }
      result.updated = updated.length
    }
    return result
  })
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ applied: report.applied, ready: report.ready, updated: report.updated, unchanged: report.unchanged.length, conflicts: report.conflicts.length, unmatched: report.unmatched.length }))
} finally { await sql.end() }
