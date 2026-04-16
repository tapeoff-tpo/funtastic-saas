/**
 * GET /api/products/search?q=검색어
 *
 * 상품코드(internalSku) 또는 상품명으로 검색. 매핑 모달에서 사용.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'
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

  return NextResponse.json({ results: rows })
}
