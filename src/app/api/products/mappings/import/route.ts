/**
 * POST /api/products/mappings/import
 *
 * 마켓플레이스 엑셀 업로드 → 상품코드로 자동 매핑 생성.
 * 엑셀에서 상품코드 컬럼과 상품명 컬럼을 자동 감지하고,
 * 상품코드를 products.internalSku와 매칭해서 매핑 일괄 생성.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, productNameMappings } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import ExcelJS from 'exceljs'

// 상품코드로 인식할 수 있는 헤더명들
const CODE_HEADERS = [
  '상품코드', '품목코드', '판매자상품코드', '업체상품코드', 'SKU',
  '자체상품코드', '옵션관리코드', '셀러상품코드', '자체코드',
  '관리코드', '바코드', '모델명',
]

// 상품명으로 인식할 수 있는 헤더명들
const NAME_HEADERS = [
  '상품명', '품목명', '등록상품명', '노출상품명', '판매상품명',
  '상품이름', '제품명', '품명',
]

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const marketplaceId = formData.get('marketplaceId') as string | null

  if (!file) return NextResponse.json({ error: 'file 필수' }, { status: 400 })
  if (!marketplaceId) return NextResponse.json({ error: 'marketplaceId 필수' }, { status: 400 })

  // Parse Excel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = Buffer.from(await file.arrayBuffer()) as any
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]

  // Auto-detect header row and columns
  let headerRow = 0
  let codeCol = 0
  let nameCol = 0
  const colMap: Record<string, number> = {}

  sheet.eachRow((row, rowNum) => {
    if (headerRow) return
    const cellValues: string[] = []
    row.eachCell((cell, colNum) => {
      const val = String(cell.value ?? '').trim()
      cellValues.push(val)
      colMap[val] = colNum
    })

    // Check if this row contains recognizable headers
    const foundCode = cellValues.find((v) => CODE_HEADERS.includes(v))
    const foundName = cellValues.find((v) => NAME_HEADERS.includes(v))

    if (foundCode && foundName) {
      headerRow = rowNum
      codeCol = colMap[foundCode]
      nameCol = colMap[foundName]
    }
  })

  if (!headerRow || !codeCol || !nameCol) {
    return NextResponse.json({
      error: `상품코드/상품명 헤더를 찾을 수 없습니다. 인식 가능한 헤더: 상품코드(${CODE_HEADERS.join(', ')}), 상품명(${NAME_HEADERS.join(', ')})`,
    }, { status: 400 })
  }

  // Read rows
  type ExcelRow = { code: string; marketplaceName: string }
  const rows: ExcelRow[] = []

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= headerRow) return
    const code = String(row.getCell(codeCol)?.value ?? '').trim()
    const name = String(row.getCell(nameCol)?.value ?? '').trim()
    if (code && name) {
      rows.push({ code, marketplaceName: name })
    }
  })

  if (rows.length === 0) {
    return NextResponse.json({ error: '데이터 행이 없습니다.' }, { status: 400 })
  }

  // Load all user products
  const productRows = await db
    .select({
      id: products.id,
      internalSku: products.internalSku,
      name: products.name,
      warehouseLocation: products.warehouseLocation,
    })
    .from(products)
    .where(and(eq(products.userId, user.id), ne(products.status, 'deleted')))

  const skuToProduct = new Map<string, { id: string; name: string; location: string | null }>()
  for (const p of productRows) {
    skuToProduct.set(p.internalSku, { id: p.id, name: p.name, location: p.warehouseLocation })
  }

  // Match and create mappings
  let matched = 0
  let skipped = 0
  const toInsert: Array<{
    userId: string
    marketplaceId: string
    marketplaceName: string
    displayName: string
    productId: string
    pickingLocation: string | null
  }> = []

  const seen = new Set<string>() // deduplicate
  for (const row of rows) {
    // Try exact match first, then prefix match (e.g. "111974-0001" in "111974-0001-A")
    let product = skuToProduct.get(row.code)
    if (!product) {
      // Try matching by prefix (상품코드가 옵션코드를 포함할 수 있음)
      const codeBase = row.code.split('-').slice(0, 2).join('-')
      if (codeBase !== row.code) {
        product = skuToProduct.get(codeBase)
      }
    }

    if (product) {
      const key = `${marketplaceId}::${row.marketplaceName}`
      if (!seen.has(key)) {
        seen.add(key)
        toInsert.push({
          userId: user.id,
          marketplaceId,
          marketplaceName: row.marketplaceName,
          displayName: product.name,
          productId: product.id,
          pickingLocation: product.location,
        })
        matched++
      }
    } else {
      skipped++
    }
  }

  // Bulk insert with conflict handling
  if (toInsert.length > 0) {
    await db
      .insert(productNameMappings)
      .values(toInsert)
      .onConflictDoNothing()
  }

  return NextResponse.json({
    total: rows.length,
    matched,
    skipped,
    message: `${matched}개 매핑 생성 (${rows.length}행 중 ${skipped}개 미매칭)`,
  })
}
