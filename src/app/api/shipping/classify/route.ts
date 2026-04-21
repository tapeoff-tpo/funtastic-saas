/**
 * GET /api/shipping/classify?orderIds=...
 *
 * 선택된 주문들을 상품의 defaultCarrierId 기준으로 분류.
 * 각 주문의 첫 아이템 SKU → products.internalSku → defaultCarrierId로 매칭.
 * 택배사 미지정 주문은 'unassigned'로 분류.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, orderItems, products, productVariants } from '@/lib/db/schema'
import { inArray, and, eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orderIdsParam = req.nextUrl.searchParams.get('orderIds') ?? ''
  const orderIds = orderIdsParam.split(',').filter(Boolean)
  if (orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds 필수' }, { status: 400 })
  }

  const [orderRows, itemRows] = await Promise.all([
    db.select({ id: orders.id })
      .from(orders)
      .where(and(inArray(orders.id, orderIds), eq(orders.userId, user.id))),
    db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
  ])

  // Build SKU → carrierId lookup
  const productRows = await db
    .select({
      internalSku: products.internalSku,
      carrierId: products.defaultCarrierId,
    })
    .from(products)
    .where(eq(products.userId, user.id))

  const variantRows = await db
    .select({
      sku: productVariants.sku,
      carrierId: products.defaultCarrierId,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(products.userId, user.id))

  const skuToCarrier = new Map<string, string | null>()
  for (const p of productRows) skuToCarrier.set(p.internalSku, p.carrierId)
  for (const v of variantRows) {
    if (!skuToCarrier.has(v.sku)) skuToCarrier.set(v.sku, v.carrierId)
  }

  // Classify each order by its first item's SKU → carrier
  const classified: Record<string, string[]> = {
    cj: [],
    kyungdong: [],
    daesin: [],
    unassigned: [],
  }

  for (const order of orderRows) {
    const items = itemRows.filter((i) => i.orderId === order.id)
    const firstSku = items[0]?.sku?.trim()
    const carrier = firstSku ? skuToCarrier.get(firstSku) : null
    const bucket = carrier && classified[carrier] ? carrier : 'unassigned'
    classified[bucket].push(order.id)
  }

  return NextResponse.json(classified)
}
