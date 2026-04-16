/**
 * POST /api/products/mappings/auto
 *
 * 자동 매핑: 미매핑 주문 아이템의 SKU를 products.internalSku /
 * productVariants.sku와 매칭해서 일괄 매핑 생성.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orderItems, orders, products, productVariants, productNameMappings } from '@/lib/db/schema'
import { eq, and, sql, isNull, isNotNull, ne } from 'drizzle-orm'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 1. Get unmapped order items with SKU (last 90 days, distinct marketplaceId + productName + sku)
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  const unmappedItems = await db
    .selectDistinct({
      marketplaceId: orders.marketplaceId,
      productName: orderItems.productName,
      sku: orderItems.sku,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .leftJoin(
      productNameMappings,
      and(
        eq(productNameMappings.userId, user.id),
        eq(productNameMappings.marketplaceId, orders.marketplaceId),
        eq(productNameMappings.marketplaceName, orderItems.productName),
      ),
    )
    .where(
      and(
        eq(orders.userId, user.id),
        sql`${orders.orderedAt} >= ${ninetyDaysAgo}`,
        isNull(productNameMappings.id),
        isNotNull(orderItems.sku),
        ne(orderItems.sku, ''),
      ),
    )

  if (unmappedItems.length === 0) {
    return NextResponse.json({ matched: 0, message: '매칭 가능한 미매핑 항목이 없습니다.' })
  }

  // 2. Build SKU → product lookup
  const productRows = await db
    .select({
      internalSku: products.internalSku,
      name: products.name,
      id: products.id,
      warehouseLocation: products.warehouseLocation,
    })
    .from(products)
    .where(and(eq(products.userId, user.id), ne(products.status, 'deleted')))

  const skuToProduct = new Map<string, { id: string; name: string; location: string | null }>()
  for (const p of productRows) {
    skuToProduct.set(p.internalSku, { id: p.id, name: p.name, location: p.warehouseLocation })
  }

  // Also check variants
  const variantRows = await db
    .select({
      sku: productVariants.sku,
      productId: productVariants.productId,
      productName: products.name,
      warehouseLocation: products.warehouseLocation,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(products.userId, user.id), ne(products.status, 'deleted')))

  for (const v of variantRows) {
    if (!skuToProduct.has(v.sku)) {
      skuToProduct.set(v.sku, { id: v.productId, name: v.productName, location: v.warehouseLocation })
    }
  }

  // 3. Match and create mappings
  const toInsert: Array<{
    userId: string
    marketplaceId: string
    marketplaceName: string
    displayName: string
    productId: string
    pickingLocation: string | null
  }> = []

  for (const item of unmappedItems) {
    if (!item.sku) continue
    const match = skuToProduct.get(item.sku.trim())
    if (match) {
      toInsert.push({
        userId: user.id,
        marketplaceId: item.marketplaceId,
        marketplaceName: item.productName,
        displayName: match.name,
        productId: match.id,
        pickingLocation: match.location,
      })
    }
  }

  if (toInsert.length === 0) {
    return NextResponse.json({
      matched: 0,
      total: unmappedItems.length,
      message: `${unmappedItems.length}개 미매핑 중 SKU 매칭 결과 없음`,
    })
  }

  // 4. Bulk insert with conflict handling
  await db
    .insert(productNameMappings)
    .values(toInsert)
    .onConflictDoNothing()

  return NextResponse.json({
    matched: toInsert.length,
    total: unmappedItems.length,
    message: `${toInsert.length}개 자동 매핑 완료 (${unmappedItems.length}개 중)`,
  })
}
