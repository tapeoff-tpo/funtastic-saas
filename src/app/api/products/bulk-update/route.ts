import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, productVariants } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
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
  const buffer = Buffer.from(await file.arrayBuffer())
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

  // 1. Find existing products by internal_sku
  const existingProducts = await db
    .select({ id: products.id, internalSku: products.internalSku })
    .from(products)
    .where(inArray(products.internalSku, skus))

  const productSkuMap = new Map(existingProducts.map((p) => [p.internalSku, p.id]))

  // 2. Find existing products via product_variants.sku
  const unmatchedSkus = skus.filter((s) => !productSkuMap.has(s))
  if (unmatchedSkus.length > 0) {
    const matchedVariants = await db
      .select({ productId: productVariants.productId, sku: productVariants.sku })
      .from(productVariants)
      .where(inArray(productVariants.sku, unmatchedSkus))

    for (const v of matchedVariants) {
      productSkuMap.set(v.sku, v.productId)
    }
  }

  // 3. Process each row
  let updated = 0
  let inserted = 0
  let skipped = 0

  for (const row of rows) {
    const productId = productSkuMap.get(row.sku)

    if (productId) {
      // Existing product — update cost_price if we have one
      if (row.costPrice) {
        await db
          .update(products)
          .set({ costPrice: row.costPrice, updatedAt: new Date() })
          .where(eq(products.id, productId))
        updated++
      } else {
        skipped++
      }
    } else {
      // New product — insert
      if (!row.name) { skipped++; continue }

      try {
        await db.insert(products).values({
          userId: user.id,
          internalSku: row.sku,
          name: row.name,
          basePrice: '0',
          costPrice: row.costPrice ?? null,
          status: 'active',
        })
        inserted++
      } catch {
        skipped++
      }
    }
  }

  return NextResponse.json({
    total: rows.length,
    updated,
    inserted,
    skipped,
    message: `업데이트 ${updated}개, 신규 추가 ${inserted}개 완료`,
  })
}
