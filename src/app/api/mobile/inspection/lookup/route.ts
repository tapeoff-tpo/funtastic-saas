import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, or } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { claims, orderItems, orders, shipments } from '@/lib/db/schema'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: '검색어가 필요합니다.' }, { status: 400 })

  let orderId: string | null = null

  if (UUID_RE.test(q)) {
    const [match] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.userId, workspaceUserId), eq(orders.id, q)))
      .limit(1)
    orderId = match?.id ?? null
  }

  if (!orderId) {
    const [shipmentMatch] = await db
      .select({ orderId: shipments.orderId })
      .from(shipments)
      .where(and(eq(shipments.userId, workspaceUserId), eq(shipments.trackingNumber, q)))
      .limit(1)
    orderId = shipmentMatch?.orderId ?? null
  }

  if (!orderId) {
    const [orderMatch] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.userId, workspaceUserId),
          or(eq(orders.marketplaceOrderId, q), eq(orders.internalNo, q)),
        ),
      )
      .limit(1)
    orderId = orderMatch?.id ?? null
  }

  if (!orderId) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })

  const [order] = await db
    .select({
      id: orders.id,
      internalNo: orders.internalNo,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
      status: orders.status,
      buyerName: orders.buyerName,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
      recipientPhone2: orders.recipientPhone2,
      orderedAt: orders.orderedAt,
      collectedAt: orders.collectedAt,
      logisticsMessage: orders.logisticsMessage,
      deliveryMessage: orders.deliveryMessage,
    })
    .from(orders)
    .where(and(eq(orders.userId, workspaceUserId), eq(orders.id, orderId)))
    .limit(1)

  if (!order) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })

  const [items, claimRows, shipmentRows] = await Promise.all([
    db
      .select({
        id: orderItems.id,
        productName: orderItems.productName,
        optionText: orderItems.optionText,
        quantity: orderItems.quantity,
        sku: orderItems.sku,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id)),
    db
      .select({
        id: claims.id,
        claimType: claims.claimType,
        claimStatus: claims.claimStatus,
        reason: claims.reason,
        requestedAt: claims.requestedAt,
      })
      .from(claims)
      .where(and(eq(claims.userId, workspaceUserId), eq(claims.orderId, order.id)))
      .orderBy(desc(claims.requestedAt)),
    db
      .select({
        id: shipments.id,
        trackingNumber: shipments.trackingNumber,
        carrierName: shipments.carrierName,
        uploadStatus: shipments.uploadStatus,
      })
      .from(shipments)
      .where(and(eq(shipments.userId, workspaceUserId), eq(shipments.orderId, order.id)))
      .orderBy(desc(shipments.createdAt)),
  ])

  return NextResponse.json({
    order: {
      ...order,
      items,
      claims: claimRows,
      shipments: shipmentRows,
    },
  })
}
