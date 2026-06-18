import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { marketplaceConnections, orderItems, orders, shipments } from '@/lib/db/schema'
import { MARKETPLACE_DISPLAY_NAMES } from '@/lib/marketplace/collect-options'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const trackingNumber = req.nextUrl.searchParams.get('trackingNumber')?.trim()

  if (!trackingNumber) {
    return NextResponse.json({ error: '송장번호를 입력해주세요.' }, { status: 400 })
  }
  const normalizedTrackingNumber = trackingNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase()

  const [row] = await db
    .select({
      shipmentId: shipments.id,
      trackingNumber: shipments.trackingNumber,
      carrierName: shipments.carrierName,
      shippedAt: shipments.shippedAt,
      orderId: orders.id,
      internalNo: orders.internalNo,
      marketplaceId: orders.marketplaceId,
      systemMarketplaceName: sql<string | null>`NULLIF(${marketplaceConnections.metadata}->>'systemMarketplaceName', '')`,
      marketplaceOrderId: orders.marketplaceOrderId,
      status: orders.status,
      buyerName: orders.buyerName,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
      deliveryMessage: orders.deliveryMessage,
      shippingAddress: orders.shippingAddress,
      orderedAt: orders.orderedAt,
    })
    .from(shipments)
    .innerJoin(orders, eq(shipments.orderId, orders.id))
    .leftJoin(marketplaceConnections, eq(marketplaceConnections.id, orders.connectionId))
    .where(and(
      eq(shipments.userId, workspaceUserId),
      eq(shipments.normalizedTrackingNumber, normalizedTrackingNumber),
    ))
    .orderBy(desc(shipments.createdAt))
    .limit(1)

  if (!row) {
    return NextResponse.json({ found: false, trackingNumber })
  }

  const items = await db
    .select({
      id: orderItems.id,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      quantity: orderItems.quantity,
      sku: orderItems.sku,
      lockedProductName: orderItems.lockedProductName,
      lockedOptionName: orderItems.lockedOptionName,
      lockedQuantity: orderItems.lockedQuantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, row.orderId))

  return NextResponse.json({
    found: true,
    order: {
      ...row,
      marketplaceName: row.systemMarketplaceName ?? MARKETPLACE_DISPLAY_NAMES[row.marketplaceId] ?? row.marketplaceId,
      orderedAt: row.orderedAt.toISOString(),
      shippedAt: row.shippedAt?.toISOString() ?? null,
      items,
    },
  })
}
