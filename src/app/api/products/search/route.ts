/**
 * GET /api/products/search?q=검색어
 *
 * 상품코드(internalSku) 또는 상품명으로 검색.
 * 이미 매핑된 마켓 상품명을 옵션 힌트로 제공해서 variant 구분이 쉽도록 함.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, inventory } from '@/lib/db/schema'
import { eq, and, or, ilike, ne } from 'drizzle-orm'

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
      optionName: inventory.optionName,
    })
    .from(products)
    .leftJoin(
      inventory,
      and(eq(inventory.sku, products.internalSku), eq(inventory.userId, products.userId)),
    )
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

  // optionName from inventory is the primary hint.
  // Phase A 매핑 재설계: productNameMappings fallback 제거. inventory.optionName 만 사용.
  const results = rows.map((r) => ({ ...r, optionHint: r.optionName ?? null }))

  return NextResponse.json({ results })
}
