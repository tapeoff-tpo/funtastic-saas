import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, productVariants, excelImportTemplates } from '@/lib/db/schema'
import { inArray, sql, eq, and } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { logProductChanges } from '@/lib/products/change-log'

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

  // Load template mapping if provided
  const templateId = formData.get('templateId') as string | null
  type FieldMapping = { field: string; excelColumn: string }
  let templateMappings: FieldMapping[] | null = null

  if (templateId) {
    const [template] = await db
      .select()
      .from(excelImportTemplates)
      .where(and(eq(excelImportTemplates.id, templateId), eq(excelImportTemplates.userId, user.id)))
      .limit(1)
    if (template) {
      templateMappings = template.mappings as FieldMapping[]
    }
  }

  // Parse Excel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = Buffer.from(await file.arrayBuffer()) as any
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]

  // Find header row — search for the SKU column name
  const skuColumnName = templateMappings
    ? templateMappings.find((m) => m.field === 'internal_sku')?.excelColumn ?? '품목코드'
    : '품목코드'

  let headerRow = 0
  const colMap: Record<string, number> = {}

  sheet.eachRow((row, rowNum) => {
    if (headerRow) return
    row.eachCell((cell, colNum) => {
      if (String(cell.value ?? '').trim() === skuColumnName) {
        headerRow = rowNum
        colMap[skuColumnName] = colNum
      }
    })
    if (headerRow) {
      row.eachCell((cell, colNum) => {
        colMap[String(cell.value ?? '').trim()] = colNum
      })
    }
  })

  if (!headerRow) {
    return NextResponse.json({ error: `"${skuColumnName}" 헤더를 찾을 수 없습니다.` }, { status: 400 })
  }

  // Helper: read cell value as trimmed string or null
  const readCell = (row: ExcelJS.Row, columnName: string): string | null => {
    const colIdx = colMap[columnName]
    if (!colIdx) return null
    const val = row.getCell(colIdx)?.value
    if (val == null) return null
    const str = String(val).trim()
    return str !== '' && str !== 'x' ? str : null
  }

  // Build field→excelColumn lookup from template or use hardcoded defaults
  const fieldColumnMap: Record<string, string> = {}
  if (templateMappings) {
    for (const m of templateMappings) fieldColumnMap[m.field] = m.excelColumn
  } else {
    // Legacy hardcoded ESA009M mapping
    fieldColumnMap['internal_sku'] = '품목코드'
    fieldColumnMap['name'] = '품목명'
    fieldColumnMap['cost_price'] = 'works 신규 원가'
    fieldColumnMap['cost_price_fallback'] = 'works 기존 원가'
    fieldColumnMap['warehouse_location'] = '한국창고기준 위치'
  }

  // Read all rows
  type ExcelRow = {
    sku: string; name: string; costPrice: string | null; warehouseLocation: string | null
    basePrice: string | null; categoryId: string | null; description: string | null
    defaultCarrierId: string | null
  }
  const rows: ExcelRow[] = []

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= headerRow) return
    const sku = readCell(row, fieldColumnMap['internal_sku'] ?? '품목코드')
    if (!sku) return

    const name = readCell(row, fieldColumnMap['name'] ?? '품목명') ?? ''

    // Cost price: template column or legacy fallback
    let costPrice = readCell(row, fieldColumnMap['cost_price'] ?? '')
    if (!costPrice && fieldColumnMap['cost_price_fallback']) {
      costPrice = readCell(row, fieldColumnMap['cost_price_fallback'])
    }

    const warehouseLocation = readCell(row, fieldColumnMap['warehouse_location'] ?? '')
    const basePrice = readCell(row, fieldColumnMap['base_price'] ?? '')
    const categoryId = readCell(row, fieldColumnMap['category_id'] ?? '')
    const description = readCell(row, fieldColumnMap['description'] ?? '')
    const defaultCarrierId = readCell(row, fieldColumnMap['default_carrier_id'] ?? '')

    rows.push({ sku, name, costPrice, warehouseLocation, basePrice, categoryId, description, defaultCarrierId })
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
  const toUpdate: Array<{ id: string; costPrice: string | null; warehouseLocation: string | null }> = []
  const toInsert: Array<{
    userId: string
    internalSku: string
    name: string
    basePrice: string
    costPrice: string | null
    warehouseLocation: string | null
    defaultCarrierId: string | null
    categoryId: string | null
    description: string | null
    status: 'active'
  }> = []
  let skipped = 0

  for (const row of rows) {
    const productId = productSkuMap.get(row.sku)
    if (productId) {
      if (row.costPrice || row.warehouseLocation) {
        toUpdate.push({ id: productId, costPrice: row.costPrice, warehouseLocation: row.warehouseLocation })
      } else {
        skipped++
      }
    } else {
      if (!row.name) { skipped++; continue }
      toInsert.push({
        userId: user.id,
        internalSku: row.sku,
        name: row.name,
        basePrice: row.basePrice ?? '0',
        costPrice: row.costPrice ?? null,
        warehouseLocation: row.warehouseLocation ?? null,
        defaultCarrierId: row.defaultCarrierId ?? null,
        categoryId: row.categoryId ?? null,
        description: row.description ?? null,
        status: 'active',
      })
    }
  }

  // 4. Fetch existing cost prices for change logging
  const existingPrices = new Map<string, string | null>()
  if (toUpdate.length > 0) {
    for (const chunk of chunkArray(toUpdate.map((r) => r.id), 500)) {
      const existing = await db
        .select({ id: products.id, costPrice: products.costPrice })
        .from(products)
        .where(inArray(products.id, chunk))
      for (const row of existing) existingPrices.set(row.id, row.costPrice)
    }
  }

  // 5. Bulk update — single UPDATE FROM VALUES per chunk
  let updated = 0
  for (const chunk of chunkArray(toUpdate, 500)) {
    await db.execute(sql`
      UPDATE products p
      SET cost_price = COALESCE(v.cost_price, p.cost_price),
          warehouse_location = COALESCE(v.warehouse_location, p.warehouse_location),
          updated_at = now()
      FROM (
        VALUES ${sql.join(
          chunk.map((r) => sql`(${r.id}::uuid, ${r.costPrice}::numeric, ${r.warehouseLocation}::varchar)`),
          sql`, `
        )}
      ) AS v(id, cost_price, warehouse_location)
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

  // 7. Log cost price changes
  const changeEntries = toUpdate
    .filter((r) => existingPrices.get(r.id) !== r.costPrice)
    .map((r) => ({
      productId: r.id,
      userId: user.id,
      fieldName: 'cost_price',
      oldValue: existingPrices.get(r.id) ?? null,
      newValue: r.costPrice,
    }))
  await logProductChanges(changeEntries)

  if (updated > 0 || inserted > 0) {
    revalidatePath('/analytics')
    revalidateTag('analytics', { expire: 0 })
  }

  return NextResponse.json({
    total: rows.length,
    updated,
    inserted,
    skipped,
    message: `업데이트 ${updated}개, 신규 추가 ${inserted}개 완료`,
  })
}
