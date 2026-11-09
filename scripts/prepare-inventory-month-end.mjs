import { readdir, readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { decryptSnapshotSeed } from '../src/lib/inventory/snapshot-seed-crypto.mjs'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
try {
  await sql.unsafe(await readFile(new URL('../supabase/migrations/20261109040000_inventory_month_end.sql', import.meta.url), 'utf8'))
  if (process.env.VERCEL_ENV === 'production') {
    const seedDirectory = new URL('./inventory-month-end-seeds/', import.meta.url)
    const files = (await readdir(seedDirectory)).filter((name) => name.endsWith('.json')).sort()
    const [owner] = await sql`
      SELECT id FROM user_profiles WHERE deactivated_at IS NULL
        AND (email ILIKE 'admin123%' OR display_name ILIKE 'admin123%')
      ORDER BY created_at ASC LIMIT 1
    `
    if (!owner) throw new Error('공유 워크스페이스 소유자를 찾을 수 없습니다.')
    for (const file of files) {
      const envelope = JSON.parse(await readFile(new URL(file, seedDirectory), 'utf8'))
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`inventory-month-end:${owner.id}:${envelope.month}`}))`
        const [existing] = await tx`SELECT source_hash, row_count FROM inventory_month_end_imports WHERE user_id = ${owner.id} AND reference_month = ${envelope.month}`
        if (existing) {
          if (existing.source_hash !== envelope.sourceHash) throw new Error(`${envelope.month}: 기존 월말 원본과 다른 자료입니다.`)
          const [stored] = await tx`SELECT count(*)::int AS count FROM inventory_month_end_stock WHERE user_id = ${owner.id} AND reference_month = ${envelope.month}`
          if (stored.count !== existing.row_count) throw new Error('월말 재고 저장 행 수가 일치하지 않습니다.')
          console.log(`${envelope.month} 월말 재고 ${stored.count}행 확인 완료.`)
          return
        }
        const source = decryptSnapshotSeed(process.env.DATABASE_URL, envelope)
        if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(source.month) || !Array.isArray(source.rows) || !source.rows.length) throw new Error('잘못된 월말 재고 자료입니다.')
        const [year, month] = source.month.split('-').map(Number)
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
        const asOfDate = `${source.month}-${lastDay}`
        const timestamp = `${asOfDate}T23:59:59.999+09:00`
        const identities = new Set()
        for (const row of source.rows) {
          const identity = JSON.stringify([row[0], row[3], row[4]])
          if (!row[0] || !row[1] || identities.has(identity) || ![row[6], row[7], row[8]].every(Number.isSafeInteger)) throw new Error('중복 또는 잘못된 월말 재고 행입니다.')
          identities.add(identity)
        }
        await tx`INSERT INTO inventory_month_end_imports (user_id, reference_month, source_file_name, source_hash, row_count, as_of_date)
          VALUES (${owner.id}, ${source.month}, ${source.fileName}, ${source.sourceHash}, ${source.rows.length}, ${asOfDate})`
        for (let offset = 0; offset < source.rows.length; offset += 400) {
          const rows = source.rows.slice(offset, offset + 400).map((row) => ({
            user_id: owner.id, reference_month: source.month, sku: row[0], product_name: row[1], option_name: row[2], warehouse_zone: row[3], sector_code: row[4], packaging_unit: row[5],
            total_stock: row[6], available_stock: row[6], monthly_incoming: row[7], monthly_outgoing: row[8], created_at: timestamp, updated_at: timestamp,
          }))
          await tx`INSERT INTO inventory_month_end_stock ${tx(rows)}`
        }
        const stored = await tx`SELECT warehouse_zone, count(*)::int AS count, coalesce(sum(available_stock), 0)::text AS stock
          FROM inventory_month_end_stock WHERE user_id = ${owner.id} AND reference_month = ${source.month} GROUP BY warehouse_zone`
        const expected = new Map()
        for (const row of source.rows) {
          const previous = expected.get(row[3]) ?? { count: 0, stock: 0 }
          expected.set(row[3], { count: previous.count + 1, stock: previous.stock + row[6] })
        }
        if (stored.length !== expected.size || stored.some((row) => row.count !== expected.get(row.warehouse_zone)?.count || Number(row.stock) !== expected.get(row.warehouse_zone)?.stock)) throw new Error('월말 재고 창고별 합계 검증에 실패했습니다.')
        console.log(`${source.month} 월말 재고 ${source.rows.length}행 저장 및 창고별 합계 검증 완료.`)
      })
    }
  }
} finally {
  await sql.end()
}
