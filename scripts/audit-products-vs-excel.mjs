/**
 * Compare products in the DB vs 사방넷 재고코드관리 Excel.
 * Reports: total counts, SKUs in Excel but not in DB, SKUs in DB but not in Excel.
 */
import postgres from 'postgres'
import ExcelJS from 'exceljs'

const EXCEL_PATH = '/Users/ian/Downloads/재고코드관리_다운로드.xlsx'

const sql = postgres(process.env.DATABASE_URL)

try {
  // 1. Read Excel
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(EXCEL_PATH)
  const sheet = wb.worksheets[0]

  const excelRows = []
  for (let i = 4; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i)
    const sku = row.getCell(4).value
    const modelName = row.getCell(5).value
    const productName = row.getCell(6).value
    const variantName = row.getCell(8).value
    const codeStatus = row.getCell(21).value
    const dbStatus = row.getCell(22).value
    const selfProductCode = row.getCell(25).value
    const optionAlias = row.getCell(26).value
    if (!sku) continue
    excelRows.push({
      sku: String(sku).trim(),
      modelName: modelName ? String(modelName).trim() : null,
      productName: productName ? String(productName).trim() : null,
      variantName: variantName ? String(variantName).trim() : null,
      codeStatus: codeStatus ? String(codeStatus).trim() : null,
      dbStatus: dbStatus ? String(dbStatus).trim() : null,
      selfProductCode: selfProductCode ? String(selfProductCode).trim() : null,
      optionAlias: optionAlias ? String(optionAlias).trim() : null,
    })
  }

  console.log('=== Excel ===')
  console.log('Total rows:', excelRows.length)
  const byDbStatus = new Map()
  for (const r of excelRows) {
    byDbStatus.set(r.dbStatus, (byDbStatus.get(r.dbStatus) ?? 0) + 1)
  }
  console.log('By DB 상태:', [...byDbStatus.entries()])

  // Unique base codes (before - variant suffix)
  const baseSkus = new Set()
  for (const r of excelRows) {
    const base = r.sku.includes('-') ? r.sku.split('-')[0] : r.sku
    baseSkus.add(base)
  }
  console.log('Unique base 상품코드 (before dash):', baseSkus.size)

  // 2. Read DB
  const dbProducts = await sql`
    SELECT p.id, p.internal_sku, p.name, p.status, COUNT(v.id) as variant_count
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id
    GROUP BY p.id, p.internal_sku, p.name, p.status
  `
  const dbVariants = await sql`
    SELECT v.sku, v.option_name, p.internal_sku as product_sku
    FROM product_variants v
    INNER JOIN products p ON p.id = v.product_id
  `
  console.log('\n=== DB ===')
  console.log('Total products:', dbProducts.length)
  console.log('Total variants:', dbVariants.length)
  const statusMap = new Map()
  for (const p of dbProducts) {
    statusMap.set(p.status, (statusMap.get(p.status) ?? 0) + 1)
  }
  console.log('By status:', [...statusMap.entries()])

  // 3. Compare SKUs
  const excelSkus = new Set(excelRows.map((r) => r.sku))
  const excelActiveSkus = new Set(
    excelRows.filter((r) => r.dbStatus === '공급중' || r.dbStatus === '공급준비중').map((r) => r.sku),
  )
  const dbSkus = new Set([
    ...dbProducts.map((p) => p.internal_sku),
    ...dbVariants.map((v) => v.sku),
  ])

  const inExcelNotDb = [...excelSkus].filter((s) => !dbSkus.has(s))
  const inDbNotExcel = [...dbSkus].filter((s) => !excelSkus.has(s))

  console.log('\n=== Gap ===')
  console.log('Excel SKUs total:', excelSkus.size)
  console.log('Excel SKUs active(공급중/준비중):', excelActiveSkus.size)
  console.log('DB SKUs (products + variants):', dbSkus.size)
  console.log('In Excel but not in DB:', inExcelNotDb.length)
  console.log('In DB but not in Excel:', inDbNotExcel.length)

  console.log('\n--- Sample missing SKUs (Excel → not in DB) ---')
  for (const sku of inExcelNotDb.slice(0, 20)) {
    const row = excelRows.find((r) => r.sku === sku)
    console.log(`  ${sku}: ${row?.productName ?? ''} | ${row?.variantName ?? ''} | ${row?.dbStatus ?? ''}`)
  }

  // Count missing by dbStatus
  const missingByStatus = new Map()
  for (const sku of inExcelNotDb) {
    const row = excelRows.find((r) => r.sku === sku)
    const st = row?.dbStatus ?? 'unknown'
    missingByStatus.set(st, (missingByStatus.get(st) ?? 0) + 1)
  }
  console.log('\nMissing count by 상태:', [...missingByStatus.entries()])
} catch (e) {
  console.error('ERR:', e)
  process.exit(1)
}
await sql.end()
