/**
 * POST /api/products/marketplace-categories
 * 상품의 마켓별 카테고리 설정 (upsert).
 *
 * Body: {
 *   productId: string
 *   marketplaceId: string
 *   marketplaceProductId?: string  // 없으면 내부 SKU 사용
 *   categoryId: string
 *   categoryName?: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { products, productMarketplaceLinks } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    productId: string
    marketplaceId: string
    marketplaceProductId?: string
    categoryId: string
    categoryName?: string
  }

  if (!body.productId || !body.marketplaceId || !body.categoryId) {
    return NextResponse.json({ error: 'productId, marketplaceId, categoryId 필수' }, { status: 400 })
  }

  // Verify product ownership
  const [product] = await db
    .select({ id: products.id, internalSku: products.internalSku })
    .from(products)
    .where(and(eq(products.id, body.productId), eq(products.userId, user.id)))
    .limit(1)

  if (!product) {
    return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 })
  }

  // Use internal SKU as fallback marketplace product ID if not provided
  const marketplaceProductId = body.marketplaceProductId || product.internalSku

  await db
    .insert(productMarketplaceLinks)
    .values({
      productId: body.productId,
      marketplaceId: body.marketplaceId,
      marketplaceProductId,
      marketplaceCategoryId: body.categoryId,
      marketplaceCategoryName: body.categoryName || null,
    })
    .onConflictDoUpdate({
      target: [productMarketplaceLinks.marketplaceId, productMarketplaceLinks.marketplaceProductId],
      set: {
        marketplaceCategoryId: body.categoryId,
        marketplaceCategoryName: body.categoryName || null,
        updatedAt: new Date(),
      },
    })

  return NextResponse.json({ success: true })
}
