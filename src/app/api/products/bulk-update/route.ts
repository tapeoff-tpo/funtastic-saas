import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, productVariants } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import ExcelJS from 'exceljs'

/**
 * POST /api/products/bulk-update
 * Excel 파일을 업로드하면 품목코드로 매칭하여 원가(KRW)를 일괄 업데이트한다.
 * Excel 컬럼: 품목코드, works 신규 원가, works 기존 원가
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
  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const sheet = workbook.worksheets[0]

  // Find header row (row with 품목코드)
  let headerRow = 0
  let colMap: Record<string, number> = {}
  sheet.eachRow((row, rowNum) => {
    if (headerRow) return
    row.eachCell((cell, colNum) => {
      const val = String(cell.value ?? '').trim()
      if (val === '품목코드') {
        headerRow = rowNum
        colMap['품목코드'] = colNum
      }
    })
    if (headerRow) {
      row.eachCell((cell, colNum) => {
        const val = String(cell.value ?? '').trim()
        colMap[val] = colNum
      })
    }
  })

  if (!headerRow) {
    return NextResponse.json({ error: '품목코드 헤더를 찾을 수 없습니다.' }, { status: 400 })
  }

  // Read rows
  type Row = { sku: string; costPrice: string | null }
  const rows: Row[] = []

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= headerRow) return
    const sku = String(row.getCell(colMap['품목코드'])?.value ?? '').trim()
    if (!sku) return

    // works 신규 원가 우선, 없으면 works 기존 원가
    const newCost = row.getCell(colMap['works 신규 원가'])?.value
    const oldCost = row.getCell(colMap['works 기존 원가'])?.value
    const cost = newCost ?? oldCost
    const costPrice = cost != null && String(cost).trim() !== '' ? String(cost) : null

    rows.push({ sku, costPrice })
  })

  const skus = rows.map((r) => r.sku).filter(Boolean)
  if (skus.length === 0) {
    return NextResponse.json({ error: '데이터가 없습니다.' }, { status: 400 })
  }

  // 1. Match by products.internal_sku
  const matchedProducts = await db
    .select({ id: products.id, internalSku: products.internalSku })
    .from(products)
    .where(inArray(products.internalSku, skus))

  const productSkuMap = new Map(matchedProducts.map((p) => [p.internalSku, p.id]))

  // 2. Match by product_variants.sku (for unmatched SKUs)
  const unmatchedSkus = skus.filter((s) => !productSkuMap.has(s))
  let variantSkuMap = new Map<string, string>() // sku → productId

  if (unmatchedSkus.length > 0) {
    const matchedVariants = await db
      .select({ productId: productVariants.productId, sku: productVariants.sku })
      .from(productVariants)
      .where(inArray(productVariants.sku, unmatchedSkus))

    variantSkuMap = new Map(matchedVariants.map((v) => [v.sku, v.productId]))
  }

  // 3. Update cost_price
  let updated = 0
  let skipped = 0
  let noCost = 0

  for (const row of rows) {
    if (!row.costPrice) { noCost++; continue }

    const productId = productSkuMap.get(row.sku) ?? variantSkuMap.get(row.sku)
    if (!productId) { skipped++; continue }

    await db
      .update(products)
      .set({ costPrice: row.costPrice, updatedAt: new Date() })
      .where(eq(products.id, productId))

    updated++
  }

  return NextResponse.json({
    total: rows.length,
    updated,
    skipped,
    noCost,
    message: `${updated}개 상품 원가 업데이트 완료`,
  })
}
