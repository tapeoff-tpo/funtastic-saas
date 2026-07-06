import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { parseMonthlySalesCalculator } from '../src/lib/purchasing/monthly-sales-calculator'

const DEFAULT_FILE = '\\\\tapeoff\\homes\\tapeoff\\9. SCM\\3.매출정리\\7.구매파일\\1. 월 판매 계산기.xlsx'
const apply = process.argv.includes('--apply')
const fileFlag = process.argv.indexOf('--file')
const filePath = fileFlag >= 0 ? process.argv[fileFlag + 1] : DEFAULT_FILE

if (!filePath) throw new Error('--file 다음에 월 판매 계산기 경로를 입력해주세요.')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.')

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 20,
})

async function main() {
  try {
    const file = await readFile(filePath)
    const fileBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
    const { rows } = await parseMonthlySalesCalculator(fileBuffer)
    const ownerId = await findWorkspaceOwnerId()
    const products = await sql<{ internal_sku: string }[]>`
      SELECT internal_sku
      FROM products
      WHERE user_id = ${ownerId}
        AND metadata->'esa009m' IS NOT NULL
    `
    const productSkus = new Set(products.map((row) => row.internal_sku))
    const workbookSkus = new Set(rows.map((row) => row.internalSku))
    const matched = rows.filter((row) => productSkus.has(row.internalSku))
    const missing = rows.filter((row) => !productSkus.has(row.internalSku))
    const productsWithoutMetrics = products.filter((row) => !workbookSkus.has(row.internal_sku))

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      filePath,
      workbookRows: rows.length,
      productRows: products.length,
      matched: matched.length,
      workbookMissingInProducts: missing.length,
      productsMissingInWorkbook: productsWithoutMetrics.length,
      workbookMissingSample: missing.slice(0, 10).map((row) => row.internalSku),
      productsMissingSample: productsWithoutMetrics.slice(0, 10).map((row) => row.internal_sku),
    }, null, 2))

    if (!apply) {
      console.log('읽기 전용 확인 완료. 실제 반영은 --apply를 추가하세요.')
      return
    }

    const importedAt = new Date().toISOString()
    let updated = 0
    await sql.begin(async (transaction) => {
      for (const batch of chunks(matched, 250)) {
        const payload = batch.map((row) => ({
          sku: row.internalSku,
          metrics: {
            currentMonthOutgoing: row.currentMonthOutgoing,
            threeMonthAverageOutgoing: row.threeMonthAverageOutgoing,
            source: 'monthly-sales-calculator',
            referenceMonth: '2026-06',
            importedAt,
          },
        }))
        const result = await transaction<{ internal_sku: string }[]>`
          UPDATE products AS product
          SET
            metadata = jsonb_set(
              COALESCE(product.metadata, '{}'::jsonb),
              '{purchasingOutgoingMetrics}',
              incoming.metrics,
              true
            ),
            updated_at = NOW()
          FROM jsonb_to_recordset(${transaction.json(payload)}::jsonb) AS incoming(sku text, metrics jsonb)
          WHERE product.user_id = ${ownerId}
            AND product.internal_sku = incoming.sku
            AND product.metadata->'esa009m' IS NOT NULL
          RETURNING product.internal_sku
        `
        updated += result.length
      }
    })
    console.log(JSON.stringify({ updated, referenceMonth: '2026-06', importedAt }, null, 2))
  } finally {
    await sql.end()
  }
}

async function findWorkspaceOwnerId() {
  const adminOwner = await sql<{ id: string }[]>`
    SELECT id
    FROM user_profiles
    WHERE deactivated_at IS NULL
      AND (email ILIKE 'admin123%' OR display_name ILIKE 'admin123%')
    ORDER BY created_at ASC
    LIMIT 1
  `
  if (adminOwner[0]?.id) return adminOwner[0].id

  const connectionOwner = await sql<{ id: string }[]>`
    SELECT user_id AS id
    FROM marketplace_connections
    ORDER BY created_at ASC
    LIMIT 1
  `
  if (connectionOwner[0]?.id) return connectionOwner[0].id

  const orderOwner = await sql<{ id: string }[]>`
    SELECT user_id AS id
    FROM orders
    ORDER BY created_at ASC
    LIMIT 1
  `
  if (orderOwner[0]?.id) return orderOwner[0].id

  const productOwner = await sql<{ id: string }[]>`
    SELECT user_id AS id
    FROM products
    ORDER BY created_at ASC
    LIMIT 1
  `
  if (productOwner[0]?.id) return productOwner[0].id
  throw new Error('공유 데이터 소유자를 찾을 수 없습니다.')
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
