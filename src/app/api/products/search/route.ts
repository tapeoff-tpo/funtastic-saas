/**
 * GET /api/products/search?q=검색어
 *
 * 상품코드(internalSku) 또는 상품명으로 검색.
 * 이미 매핑된 마켓 상품명을 옵션 힌트로 제공해서 variant 구분이 쉽도록 함.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, productNameMappings } from '@/lib/db/schema'
import { eq, and, or, ilike, ne, inArray } from 'drizzle-orm'

/** 마켓 상품명에서 옵션 힌트 추출: "상품명, 옵션A, 1개" → "옵션A" */
function extractOptionHint(fullName: string, baseName: string): string | null {
  const base = baseName.trim().toLowerCase()
  const full = fullName.trim()
  // 기본 상품명이 포함돼 있으면 뒤의 나머지를 옵션으로 추정
  const idx = full.toLowerCase().indexOf(base)
  if (idx === -1) {
    // 마켓 이름이 완전히 다른 경우 — 그냥 짧게 줄여서 표시
    return full.length > 30 ? full.slice(0, 28) + '...' : full
  }
  const rest = full.slice(idx + base.length).replace(/^[\s,·\-()[\]]+/, '').trim()
  if (!rest) return null
  // "블랙, 1개" 같은 문자열에서 앞쪽 토큰 하나 or 두개 추출
  const firstComma = rest.indexOf(',')
  const hint = firstComma > 0 ? rest.slice(0, firstComma) : rest
  const trimmed = hint.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 30) : null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] })
  }

  const pattern = `%${q}%`
  const rows = await db
    .select({
      id: products.id,
      internalSku: products.internalSku,
      name: products.name,
      warehouseLocation: products.warehouseLocation,
    })
    .from(products)
    .where(
      and(
        eq(products.userId, user.id),
        ne(products.status, 'deleted'),
        or(
          ilike(products.internalSku, pattern),
          ilike(products.name, pattern),
        ),
      ),
    )
    .limit(20)

  // Enrich each product with option hint from existing mappings
  let results = rows.map((r) => ({ ...r, optionHint: null as string | null }))
  if (rows.length > 0) {
    const productIds = rows.map((r) => r.id)
    const mappingRows = await db
      .select({
        productId: productNameMappings.productId,
        marketplaceName: productNameMappings.marketplaceName,
      })
      .from(productNameMappings)
      .where(
        and(
          eq(productNameMappings.userId, user.id),
          inArray(productNameMappings.productId, productIds),
        ),
      )

    const hintByProduct = new Map<string, string>()
    for (const m of mappingRows) {
      if (!m.productId) continue
      if (hintByProduct.has(m.productId)) continue
      const product = rows.find((r) => r.id === m.productId)
      if (!product) continue
      const hint = extractOptionHint(m.marketplaceName, product.name)
      if (hint) hintByProduct.set(m.productId, hint)
    }

    results = rows.map((r) => ({
      ...r,
      optionHint: hintByProduct.get(r.id) ?? null,
    }))
  }

  return NextResponse.json({ results })
}
