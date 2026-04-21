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
import { products, productNameMappings, productMarketplaceLinks } from '@/lib/db/schema'
import { eq, and, ne, sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'

// 상품코드로 인식할 수 있는 헤더명들 (자체코드 우선, 없으면 플랫폼 ID 사용)
const CODE_HEADERS = [
  '상품코드', '품목코드', '판매자상품코드', '업체상품코드', 'SKU',
  '자체상품코드', '옵션관리코드', '셀러상품코드', '자체코드',
  '관리코드', '바코드', '모델명', '모델번호',
  // 쿠팡 등 플랫폼 자체 ID (자체코드가 없을 때 fallback)
  '등록상품ID', '노출상품ID',
]

// 상품명으로 인식할 수 있는 헤더명들
const NAME_HEADERS = [
  '상품명', '품목명', '등록상품명', '노출상품명', '판매상품명',
  '상품이름', '제품명', '품명', '쿠팡 노출상품명',
]

// 카테고리로 인식할 수 있는 헤더명들
const CATEGORY_HEADERS = [
  '카테고리', '카테고리명', '분류', '대분류', '중분류', '소분류',
]

// 마켓 플랫폼 상품ID 헤더
const MARKETPLACE_PRODUCT_ID_HEADERS = [
  '등록상품ID', '노출상품ID', '마켓상품ID', '판매자상품ID',
]

/** Extract display text from ExcelJS cell value (handles rich text, formulas, etc.) */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>
    if ('text' in v && typeof v.text === 'string') return v.text.trim()
    if ('richText' in v && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text: string }>).map((t) => t.text).join('').trim()
    }
    if ('result' in v) return String(v.result ?? '').trim()
    if (v instanceof Date) return v.toISOString()
  }
  return String(value).trim()
}

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

  // Search ALL sheets for one with recognizable headers (scan up to row 15)
  let sheet: ExcelJS.Worksheet | null = null
  let headerRow = 0
  let codeCol = 0
  let nameCol = 0
  let categoryCol = 0
  let marketProductIdCol = 0

  for (const ws of workbook.worksheets) {
    if (!ws || ws.rowCount < 2) continue
    const maxScan = Math.min(15, ws.rowCount)
    for (let r = 1; r <= maxScan; r++) {
      const row = ws.getRow(r)
      const rowHeaders: Record<string, number> = {}
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const val = cellText(cell.value)
        if (val) rowHeaders[val] = colNum
      })
      const foundCode = Object.keys(rowHeaders).find((v) => CODE_HEADERS.includes(v))
      const foundName = Object.keys(rowHeaders).find((v) => NAME_HEADERS.includes(v))
      if (foundCode && foundName) {
        sheet = ws
        headerRow = r
        codeCol = rowHeaders[foundCode]
        nameCol = rowHeaders[foundName]
        // Optional columns
        const foundCategory = Object.keys(rowHeaders).find((v) => CATEGORY_HEADERS.includes(v))
        const foundMarketId = Object.keys(rowHeaders).find((v) => MARKETPLACE_PRODUCT_ID_HEADERS.includes(v))
        if (foundCategory) categoryCol = rowHeaders[foundCategory]
        if (foundMarketId) marketProductIdCol = rowHeaders[foundMarketId]
        break
      }
    }
    if (sheet) break
  }

  if (!sheet || !headerRow || !codeCol || !nameCol) {
    // Collect all seen headers across sheets for helpful error
    const seenHeaders = new Set<string>()
    for (const ws of workbook.worksheets) {
      const maxScan = Math.min(15, ws.rowCount)
      for (let r = 1; r <= maxScan; r++) {
        ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
          const v = cellText(cell.value)
          if (v && v.length < 30) seenHeaders.add(v)
        })
      }
    }
    return NextResponse.json({
      error: `상품코드/상품명 헤더를 찾을 수 없습니다.\n\n인식 가능한 상품코드 헤더: ${CODE_HEADERS.join(', ')}\n인식 가능한 상품명 헤더: ${NAME_HEADERS.join(', ')}\n\n엑셀에서 찾은 헤더 일부: ${[...seenHeaders].slice(0, 20).join(', ')}`,
    }, { status: 400 })
  }

  /** Parse Coupang-style category: "[80783] 주방용품>주방잡화" → { id: "80783", name: "주방용품>주방잡화" } */
  function parseCategory(raw: string): { id: string; name: string } | null {
    if (!raw) return null
    const match = raw.match(/^\[(\d+)\]\s*(.+)$/)
    if (match) return { id: match[1], name: match[2].trim() }
    // No bracket prefix — treat whole string as name, no ID
    return { id: '', name: raw.trim() }
  }

  // Read rows (dedupe by marketplaceName to avoid processing option rows as separate products)
  type ExcelRow = {
    code: string
    marketplaceName: string
    categoryId: string
    categoryName: string
    marketProductId: string
  }
  const rows: ExcelRow[] = []
  const seenNames = new Set<string>()

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= headerRow) return
    const code = cellText(row.getCell(codeCol)?.value)
    const name = cellText(row.getCell(nameCol)?.value)
    if (!code || !name || seenNames.has(name)) return
    seenNames.add(name)

    const categoryRaw = categoryCol ? cellText(row.getCell(categoryCol)?.value) : ''
    const cat = parseCategory(categoryRaw)
    const marketProductId = marketProductIdCol ? cellText(row.getCell(marketProductIdCol)?.value) : ''

    rows.push({
      code,
      marketplaceName: name,
      categoryId: cat?.id ?? '',
      categoryName: cat?.name ?? '',
      marketProductId,
    })
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

  // Exact SKU lookup
  const skuToProduct = new Map<string, { id: string; name: string; location: string | null; sku: string }>()
  for (const p of productRows) {
    skuToProduct.set(p.internalSku, { id: p.id, name: p.name, location: p.warehouseLocation, sku: p.internalSku })
  }

  // Prefix lookup: "110xxxxx" → [products starting with "110xxxxx-"]
  // Builds a map from each possible prefix (split on "-") to the list of matching products
  const prefixToProducts = new Map<string, Array<{ id: string; name: string; location: string | null; sku: string }>>()
  for (const p of productRows) {
    // Extract prefix before first "-"
    const dashIdx = p.internalSku.indexOf('-')
    if (dashIdx > 0) {
      const prefix = p.internalSku.slice(0, dashIdx)
      const arr = prefixToProducts.get(prefix) ?? []
      arr.push({ id: p.id, name: p.name, location: p.warehouseLocation, sku: p.internalSku })
      prefixToProducts.set(prefix, arr)
    }
  }

  // Name lookup (normalized, lowercased) — fallback when code doesn't match
  const normalizeName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const nameToProduct = new Map<string, { id: string; name: string; location: string | null; sku: string }>()
  for (const p of productRows) {
    const key = normalizeName(p.name)
    if (key && !nameToProduct.has(key)) {
      nameToProduct.set(key, { id: p.id, name: p.name, location: p.warehouseLocation, sku: p.internalSku })
    }
  }

  // Match and create mappings
  let matched = 0
  let prefixMatched = 0
  let nameMatched = 0
  let skipped = 0
  const unmatchedSamples: Array<{ code: string; name: string }> = []
  const toInsert: Array<{
    userId: string
    marketplaceId: string
    marketplaceName: string
    displayName: string
    productId: string
    pickingLocation: string | null
  }> = []

  const linksToUpsert: Array<{
    productId: string
    marketplaceId: string
    marketplaceProductId: string
    marketplaceCategoryId: string | null
    rawData: Record<string, unknown> | null
  }> = []

  const seen = new Set<string>()
  for (const row of rows) {
    const code = row.code.trim()

    // 1. Exact match (marketplace code = our internal SKU exactly, e.g. "110xxxxx-0001")
    let product = skuToProduct.get(code)

    // 2. Prefix match (marketplace code is shorter like "110xxxxx", our SKUs are "110xxxxx-0001, -0002"...)
    //    Link to first variant — actual option mapping happens at order time
    if (!product) {
      const prefixMatches = prefixToProducts.get(code)
      if (prefixMatches && prefixMatches.length > 0) {
        product = prefixMatches[0]
        prefixMatched++
      }
    }

    // 3. Prefix-of-code match (marketplace code contains option suffix, we match by prefix)
    if (!product) {
      const dashIdx = code.indexOf('-')
      if (dashIdx > 0) {
        const codePrefix = code.slice(0, dashIdx)
        const prefixMatches = prefixToProducts.get(codePrefix)
        if (prefixMatches && prefixMatches.length > 0) {
          product = prefixMatches[0]
          prefixMatched++
        }
      }
    }

    // 4. Name fallback (exact normalized name match) — for marketplaces like Coupang
    //    where Excel doesn't expose seller product code, only platform IDs
    if (!product) {
      const nameKey = normalizeName(row.marketplaceName)
      const nameMatch = nameToProduct.get(nameKey)
      if (nameMatch) {
        product = nameMatch
        nameMatched++
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

        // Collect marketplace link info (productId → marketplace info)
        if (row.marketProductId) {
          linksToUpsert.push({
            productId: product.id,
            marketplaceId,
            marketplaceProductId: row.marketProductId,
            marketplaceCategoryId: row.categoryId || null,
            rawData: row.categoryName ? { categoryName: row.categoryName } : null,
          })
        }
      }
    } else {
      skipped++
      if (unmatchedSamples.length < 5) {
        unmatchedSamples.push({ code, name: row.marketplaceName })
      }
    }
  }

  // Bulk insert with conflict handling
  if (toInsert.length > 0) {
    await db
      .insert(productNameMappings)
      .values(toInsert)
      .onConflictDoNothing()
  }

  // Upsert productMarketplaceLinks with category info
  let categoriesLinked = 0
  if (linksToUpsert.length > 0) {
    try {
      await db
        .insert(productMarketplaceLinks)
        .values(linksToUpsert)
        .onConflictDoUpdate({
          target: [productMarketplaceLinks.marketplaceId, productMarketplaceLinks.marketplaceProductId],
          set: {
            marketplaceCategoryId: sql`EXCLUDED.marketplace_category_id`,
            rawData: sql`EXCLUDED.raw_data`,
            updatedAt: new Date(),
          },
        })
      categoriesLinked = linksToUpsert.filter((l) => l.marketplaceCategoryId).length
    } catch (err) {
      console.error('productMarketplaceLinks upsert failed:', err)
    }
  }

  const notes: string[] = []
  if (prefixMatched > 0) notes.push(`${prefixMatched}개 prefix 매칭`)
  if (nameMatched > 0) notes.push(`${nameMatched}개 상품명 매칭`)
  if (categoriesLinked > 0) notes.push(`${categoriesLinked}개 카테고리 연결`)
  const noteStr = notes.length > 0 ? ` (${notes.join(', ')})` : ''

  return NextResponse.json({
    total: rows.length,
    matched,
    prefixMatched,
    nameMatched,
    categoriesLinked,
    skipped,
    unmatchedSamples,
    message: `${matched}개 매핑 생성${noteStr} — ${rows.length}행 중 ${skipped}개 미매칭`,
  })
}
