import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import postgres from 'postgres'
import { consolidatePriceRows, CONSOLIDATED_PRICE_SHEET, PRICE_ARCHIVE_KEY, type ConsolidationRow, type ConsolidationStock } from '../src/lib/analytics/price-table-consolidation'
import { putR2Object, getR2Object } from '../src/lib/storage/r2'

const output = process.env.PRICE_CONSOLIDATION_OUTPUT ?? '/tmp/price-sheet-consolidation'
const apply = process.argv.includes('--apply')
const verify = process.argv.includes('--verify')
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 20 })

type StoredRow = ConsolidationRow & { id: string; sourceFileName: string | null; importedAt: Date; updatedAt: Date }
async function snapshot(tx: postgres.TransactionSql) {
  const query = tx as unknown as postgres.Sql
  const [owner] = await query<{ id: string | null }[]>`SELECT COALESCE(
    (SELECT id FROM user_profiles WHERE deactivated_at IS NULL AND (email ILIKE 'admin123%' OR display_name ILIKE 'admin123%') ORDER BY created_at LIMIT 1),
    (SELECT user_id FROM marketplace_connections ORDER BY created_at LIMIT 1),
    (SELECT user_id FROM orders ORDER BY created_at LIMIT 1),
    (SELECT user_id FROM products ORDER BY created_at LIMIT 1)) AS id`
  if (!owner?.id) throw new Error('공유 워크스페이스를 찾을 수 없습니다.')
  const rows = await query<StoredRow[]>`SELECT id,source_sheet_name AS "sourceSheetName",source_file_name AS "sourceFileName",
    row_number AS "rowNumber",product_code AS "productCode",product_name AS "productName",option_name AS "optionName",
    registered_product_name AS "registeredProductName",raw_data AS "rawData",imported_at AS "importedAt",updated_at AS "updatedAt"
    FROM analytics_price_table_rows WHERE user_id=${owner.id} AND source_sheet_name IN ('상품등록','메인','뉴도매',${CONSOLIDATED_PRICE_SHEET}) ORDER BY id`
  const stocks = await query<ConsolidationStock[]>`SELECT sku,SUM(available_stock)::int AS quantity,MAX(option_name) AS "optionName"
    FROM inventory WHERE user_id=${owner.id} AND warehouse_zone IN ('1창고','2창고','쿠팡','쿠팡창고') GROUP BY sku ORDER BY sku`
  return { owner: owner.id as string, rows, stocks }
}
async function main() {
  await fs.mkdir(output, { recursive: true })
  const before = await sql.begin('read only', snapshot)
  const references = before.rows.filter((row) => row.sourceSheetName === '상품등록')
  const legacy = before.rows.filter((row) => ['메인', '뉴도매'].includes(row.sourceSheetName) && !row.rawData[PRICE_ARCHIVE_KEY])
  if (verify) {
    const active = before.rows.filter((row) => row.sourceSheetName === CONSOLIDATED_PRICE_SHEET && !row.rawData[PRICE_ARCHIVE_KEY])
    const codes = active.map((row) => row.productCode)
    const available = new Map(before.stocks.map((row) => [row.sku, Number(row.quantity)]))
    const summary = { activeRows: active.length, distinctCodes: new Set(codes).size,
      noStock: active.filter((row) => !(Number(available.get(row.productCode ?? '')) > 0)).length,
      registrationRows: references.length, registrationHash: fingerprint(references), legacyActiveRows: legacy.length }
    console.log(JSON.stringify(summary, null, 2))
    if (summary.distinctCodes !== summary.activeRows || summary.noStock || summary.legacyActiveRows) throw new Error('통합 검증 실패')
    return
  }
  if (!legacy.length) throw new Error('통합할 활성 메인·뉴도매 행이 없습니다. 이미 통합되었는지 확인해주세요.')
  const backupKey = `analytics/price-table/backups/${before.owner}/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json.gz`
  const result = consolidatePriceRows({ rows: legacy, referenceRows: references, stocks: before.stocks, archiveKey: backupKey })
  const reasons = Object.fromEntries([...new Set(result.archived.map((entry) => entry.reason))].map((reason) => [reason, result.archived.filter((entry) => entry.reason === reason).length]))
  const hash = fingerprint(before)
  const summary = { fingerprint: hash, sourceRows: legacy.length, retainedRows: result.active.length,
    retainedGroups: new Set(result.active.map((row) => row.productCode!.replace(/-\d{4}$/, ''))).size,
    archivedRows: result.archived.length, reasons, registrationRows: references.length, registrationHash: fingerprint(references) }
  await fs.writeFile(output + '/preview.json', JSON.stringify(summary, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(summary, null, 2))
  if (!apply) return
  const expected = process.argv.find((arg) => arg.startsWith('--expect='))?.slice(9)
  if (!expected || hash !== expected) throw new Error('검토한 스냅샷과 현재 데이터가 다릅니다. 변경하지 않았습니다.')
  const backup = gzipSync(JSON.stringify({ createdAt: new Date().toISOString(), summary, before }))
  await putR2Object(backupKey, backup, 'application/gzip')
  const saved = Buffer.from(await (await getR2Object(backupKey)).arrayBuffer())
  if (fingerprint(saved) !== fingerprint(backup)) throw new Error('R2 원본 백업 검증에 실패했습니다. 변경하지 않았습니다.')
  await sql.begin(async (tx) => {
    const query = tx as unknown as postgres.Sql
    await query`SELECT pg_advisory_xact_lock(hashtext(${`product-link:${before.owner}`}))`
    const current = await snapshot(tx)
    if (fingerprint(current) !== hash) throw new Error('백업 후 데이터가 변경되었습니다. 변경하지 않았습니다.')
    const archiveRows = result.archived.map(({ row, reason }) => ({ id: row.id, reason }))
    const archived = await query`UPDATE analytics_price_table_rows AS target
      SET raw_data=target.raw_data || jsonb_build_object(${PRICE_ARCHIVE_KEY}::text,${backupKey}::text,'__priceArchiveReason',source.reason),updated_at=now()
      FROM jsonb_to_recordset(${JSON.stringify(archiveRows)}::jsonb) AS source(id uuid,reason text)
      WHERE target.id=source.id AND target.user_id=${before.owner}::uuid AND target.source_sheet_name IN ('메인','뉴도매')`
    const active = result.active.map((row) => ({ id: row.id, code: row.productCode, raw: row.rawData }))
    const updated = await query`UPDATE analytics_price_table_rows AS target
      SET source_sheet_name=${CONSOLIDATED_PRICE_SHEET},product_code=source.code,raw_data=source.raw,updated_at=now()
      FROM jsonb_to_recordset(${JSON.stringify(active)}::jsonb) AS source(id uuid,code text,raw jsonb)
      WHERE target.id=source.id AND target.user_id=${before.owner}::uuid AND target.source_sheet_name IN ('메인','뉴도매')`
    if (archived.count !== result.archived.length || updated.count !== result.active.length) throw new Error('변경 행 수가 다릅니다. 트랜잭션을 취소합니다.')
    const after = await snapshot(tx)
    if (fingerprint(after.rows.filter((row) => row.sourceSheetName === '상품등록')) !== summary.registrationHash) throw new Error('상품등록 시트 변경 감지. 트랜잭션을 취소합니다.')
  })
  const manifest = { ...summary, appliedAt: new Date().toISOString(), backupKey, backupSha256: fingerprint(backup) }
  await fs.writeFile(output + '/applied.json', JSON.stringify(manifest, null, 2), { mode: 0o600 })
  console.log('R2 백업 검증 및 통합 적용 완료. 상품등록 시트는 변경하지 않았습니다.')
}
main().catch((error) => { console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted]') : '통합 작업 실패'); process.exitCode = 1 }).finally(() => sql.end())
