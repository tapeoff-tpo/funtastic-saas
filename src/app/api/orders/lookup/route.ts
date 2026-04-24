/**
 * GET /api/orders/lookup?q=...
 *
 * 주문 1건을 조회 (marketplaceOrderId 또는 orders.id로).
 * 분리출고 / 합포장 관련 UI에서 주문 preview 용도로 사용.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, orderItems } from '@/lib/db/schema'
import { and, eq, or } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'q 파라미터 필요' }, { status: 400 })

  // UUID 형태면 id로, 아니면 marketplaceOrderId로
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)
  const whereClause = isUuid
    ? and(eq(orders.userId, user.id), eq(orders.id, q))
    : and(eq(orders.userId, user.id), eq(orders.marketplaceOrderId, q))

  const [order] = await db
    .select({
      id: orders.id,
      marketplaceOrderId: orders.marketplaceOrderId,
      buyerName: orders.buyerName,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
    })
    .from(orders)
    .where(whereClause)
    .limit(1)

  if (!order) return NextResponse.json({ error: '주문을 찾을 수 없습니다' }, { status: 404 })

  const items = await db
    .select({
      id: orderItems.id,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      quantity: orderItems.quantity,
      sku: orderItems.sku,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))

  return NextResponse.json({
    ...order,
    items,
  })
}
