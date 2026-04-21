/**
 * GET /api/products/marketplace-categories/list
 * 마켓별 고유 카테고리 목록 (중복 제거) + 연결된 상품 수.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { productMarketplaceLinks, products } from '@/lib/db/schema'
import { eq, and, isNotNull, sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const marketplaceFilter = req.nextUrl.searchParams.get('marketplace')

  const conditions = [
    eq(products.userId, user.id),
    isNotNull(productMarketplaceLinks.marketplaceCategoryId),
  ]
  if (marketplaceFilter) {
    conditions.push(eq(productMarketplaceLinks.marketplaceId, marketplaceFilter))
  }

  const rows = await db
    .select({
      marketplaceId: productMarketplaceLinks.marketplaceId,
      categoryId: productMarketplaceLinks.marketplaceCategoryId,
      categoryName: productMarketplaceLinks.marketplaceCategoryName,
      productCount: sql<number>`count(*)::int`,
    })
    .from(productMarketplaceLinks)
    .innerJoin(products, eq(productMarketplaceLinks.productId, products.id))
    .where(and(...conditions))
    .groupBy(
      productMarketplaceLinks.marketplaceId,
      productMarketplaceLinks.marketplaceCategoryId,
      productMarketplaceLinks.marketplaceCategoryName,
    )
    .orderBy(sql`count(*) desc`)

  return NextResponse.json({ categories: rows })
}
