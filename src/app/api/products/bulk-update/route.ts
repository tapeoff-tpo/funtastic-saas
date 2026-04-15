import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, productVariants } from '@/lib/db/schema'
import { inArray, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'

/**
 * POST /api/products/bulk-update
 * ESA009M 양식 Excel 업로드 → 품목코드로 매칭
 * - 기존 상품: 원가(KRW) 업데이트
 * - 신규 상품: 상품 추가 (품목명 + 원가)
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'file 필드가 없습니다.' }, { status: 400 })
  }

  // Parse Excel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = Buffer.from(await file.arrayBuffer()) as any
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]

  // Find header row (row containing 품목코드)
  let headerRow = 0
  let colMap: Record<string, number> = {}

  sheet.eachRow((row, rowNum) => {
    if (headerRow) return
    row.eachCell((cell, colNum) => {
      if (String(cell.value ?? '').trim() === '품목코드') {
        headerRow = rowNum
        colMap['품목코드'] = colNum
      }
    })
    if (headerRow) {
      row.eachCell((cell, colNum) => {
        colMap[String(cell.value ?? '').trim()] = colNum
      })
    }
  })

  if (!headerRow) {
    return NextResponse.json({ error: '품목코드 헤더를 찾을 수 없습니다.' }, { status: 400 })
  }

  // Read all rows
  type ExcelRow = { sku: string; name: string; costPrice: string | null }
  const rows: ExcelRow[] = []

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= headerRow) return
    const sku = String(row.getCell(colMap['품목코드'])?.value ?? '').trim()
    if (!sku) return

    const name = String(row.getCell(colMap['품목명'])?.value ?? '').trim()

    const newCost = row.getCell(colMap['works 신규 원가'])?.value
    const oldCost = row.getCell(colMap['works 기존 원가'])?.value
    const cost = newCost ?? oldCost
    const costPrice = cost != null && String(cost).trim() !== '' && String(cost).trim() !== 'x'
      ? String(cost)
      : null

    rows.push({ sku, name, costPrice })
  })

  if (rows.length === 0) {
    return NextResponse.json({ error: '데이터가 없습니다.' }, { status: 400 })
  }

  const skus = rows.map((r) => r.sku)

  // Helper: chunk array to avoid Postgres parameter limit
  const chunkArray = <T>(arr: T[], size: number): T[][] => {
    const result: T[][] = []
    for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
    return result
  }

  // 1. Find existing products by internal_sku (chunked)
  const productSkuMap = new Map<string, string>() // sku → product id

  for (const chunk of chunkArray(skus, 500)) {
    const found = await db
      .select({ id: products.id, internalSku: products.internalSku })
      .from(products)
      .where(inArray(products.internalSku, chunk))
    for (const p of found) productSkuMap.set(p.internalSku, p.id)
  }

  // 2. Find via product_variants.sku for unmatched (chunked)
  const unmatchedSkus = skus.filter((s) => !productSkuMap.has(s))
  if (unmatchedSkus.length > 0) {
    for (const chunk of chunkArray(unmatchedSkus, 500)) {
      const matchedVariants = await db
        .select({ productId: productVariants.productId, sku: productVariants.sku })
        .from(productVariants)
        .where(inArray(productVariants.sku, chunk))
      for (const v of matchedVariants) productSkuMap.set(v.sku, v.productId)
    }
  }

  // 3. Separate rows into updates vs inserts
  const toUpdate: Array<{ id: string; costPrice: string }> = []
  const toInsert: Array<{
    userId: string
    internalSku: string
    name: string
    basePrice: string
    costPrice: string | null
    status: 'active'
  }> = []
  let skipped = 0

  for (const row of rows) {
    const productId = productSkuMap.get(row.sku)
    if (productId) {
      if (row.costPrice) {
        toUpdate.push({ id: productId, costPrice: row.costPrice })
      } else {
        skipped++
      }
    } else {
      if (!row.name) { skipped++; continue }
      toInsert.push({
        userId: user.id,
        internalSku: row.sku,
        name: row.name,
        basePrice: '0',
        costPrice: row.costPrice ?? null,
        status: 'active',
      })
    }
  }

  // 4. Bulk update — single UPDATE FROM VALUES per chunk (≤500 rows = ≤1000 params)
  let updated = 0
  for (const chunk of chunkArray(toUpdate, 500)) {
    await db.execute(sql`
      UPDATE products p
      SET cost_price = v.cost_price,
          updated_at = now()
      FROM (
        VALUES ${sql.join(
          chunk.map((r) => sql`(${r.id}::uuid, ${r.costPrice}::numeric)`),
          sql`, `
        )}
      ) AS v(id, cost_price)
      WHERE p.id = v.id
    `)
    updated += chunk.length
  }

  // 5. Bulk insert — single INSERT ... VALUES per chunk
  let inserted = 0
  for (const chunk of chunkArray(toInsert, 500)) {
    await db
      .insert(products)
      .values(chunk)
      .onConflictDoNothing()
    inserted += chunk.length
  }

  return NextResponse.json({
    total: rows.length,
    updated,
    inserted,
    skipped,
    message: `업데이트 ${updated}개, 신규 추가 ${inserted}개 완료`,
  })
}
