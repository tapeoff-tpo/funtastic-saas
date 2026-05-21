/**
 * POST /api/shipping/scan
 *
 * 바코드 스캔 처리.
 * 운송장번호로 shipments 조회 → 정상/중복/비정상 판정.
 *
 * 정상: shippedAt 기록, uploadStatus = 'pending' (마켓 전송 대기)
 * 중복: 오늘 이미 스캔된 운송장
 * 비정상: 시스템에 없는 운송장번호
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { shipments, orders, orderItems, scanLogs } from '@/lib/db/schema'
import { eq, and, gte, count, isNull, or, inArray } from 'drizzle-orm'
import { startOfDay } from 'date-fns'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const todayStart = startOfDay(new Date())

  const [rows, todayCountRows] = await Promise.all([
    db
      .select({
        trackingNumber: shipments.trackingNumber,
        carrierName: shipments.carrierName,
        shippedAt: shipments.shippedAt,
        recipientName: orders.recipientName,
        marketplaceId: orders.marketplaceId,
        marketplaceOrderId: orders.marketplaceOrderId,
      })
      .from(shipments)
      .leftJoin(orders, eq(orders.id, shipments.orderId))
      .where(and(
        eq(shipments.userId, workspaceUserId),
        or(isNull(shipments.shippedAt), gte(shipments.shippedAt, todayStart)),
      )),
    db
      .select({ value: count() })
      .from(shipments)
      .where(and(eq(shipments.userId, workspaceUserId), gte(shipments.shippedAt, todayStart))),
  ])

  return NextResponse.json({
    shipments: rows.map((row) => ({
      trackingNumber: row.trackingNumber,
      carrierName: row.carrierName,
      shippedToday: Boolean(row.shippedAt && new Date(row.shippedAt) >= todayStart),
      order: row.recipientName ? {
        recipientName: row.recipientName,
        marketplaceId: row.marketplaceId ?? '',
        marketplaceOrderId: row.marketplaceOrderId ?? '',
      } : null,
    })),
    todayCount: Number(todayCountRows[0]?.value ?? 0),
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { trackingNumber: string; includeTodayCount?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const trackingNumber = body.trackingNumber?.trim()
  if (!trackingNumber) {
    return NextResponse.json({ error: '운송장번호 없음' }, { status: 400 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  // Look up all shipments for this tracking number. 묶음 기준은
  // 마켓 + 마켓주문번호 + 운송장번호 + 택배사다. 같은 운송장번호라도
  // 다른 마켓주문번호에 연결되어 있으면 자동 정상 처리하지 않는다.
  const matchingShipments = await db
    .select({
      id: shipments.id,
      orderId: shipments.orderId,
      trackingNumber: shipments.trackingNumber,
      carrierId: shipments.carrierId,
      carrierName: shipments.carrierName,
      shippedAt: shipments.shippedAt,
      uploadStatus: shipments.uploadStatus,
      orderStatus: orders.status,
      isHeld: orders.isHeld,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
    })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .where(and(eq(shipments.userId, workspaceUserId), eq(shipments.trackingNumber, trackingNumber)))

  // 비정상: 시스템에 없는 운송장
  if (matchingShipments.length === 0) {
    // 비정상 스캔도 이력으로 남김 (shipment_id/order_id = null)
    await db.insert(scanLogs).values({
      userId: workspaceUserId,
      shipmentId: null,
      orderId: null,
      trackingNumber,
      status: 'not_found',
    })
    return NextResponse.json({
      status: 'not_found',
      message: '비정상입니다',
      tts: '비정상입니다',
    })
  }

  const groupKey = (shipment: typeof matchingShipments[number]) =>
    `${shipment.marketplaceId}::${shipment.marketplaceOrderId}::${shipment.trackingNumber ?? trackingNumber}::${shipment.carrierId}`
  const groups = new Map<string, typeof matchingShipments>()
  for (const shipment of matchingShipments) {
    const key = groupKey(shipment)
    groups.set(key, [...(groups.get(key) ?? []), shipment])
  }

  if (groups.size !== 1) {
    await db.insert(scanLogs).values(
      matchingShipments.map((shipment) => ({
        userId: workspaceUserId,
        shipmentId: shipment.id,
        orderId: shipment.orderId,
        trackingNumber,
        status: 'not_found',
      })),
    )
    return NextResponse.json({
      status: 'not_found',
      message: '비정상입니다: 같은 송장번호가 여러 주문묶음에 연결되어 있습니다',
      tts: '비정상입니다',
    })
  }

  const groupedShipments = [...groups.values()][0]
  const invalidGroup = groupedShipments.filter((shipment) =>
    shipment.isHeld || shipment.orderStatus === 'cancelled',
  )
  if (invalidGroup.length > 0) {
    await db.insert(scanLogs).values(
      groupedShipments.map((shipment) => ({
        userId: workspaceUserId,
        shipmentId: shipment.id,
        orderId: shipment.orderId,
        trackingNumber,
        status: 'not_found',
      })),
    )
    return NextResponse.json({
      status: 'not_found',
      message: '비정상입니다: 같은 주문묶음 안에 처리할 수 없는 주문이 있습니다',
      tts: '비정상입니다',
    })
  }

  // 중복: 오늘 이미 스캔됨
  const todayStart = startOfDay(new Date())
  const pendingShipments = groupedShipments.filter((shipment) => !shipment.shippedAt || new Date(shipment.shippedAt) < todayStart)
  if (pendingShipments.length === 0) {
    const shipment = groupedShipments[0]
    // Fetch order info for display
    const [order] = await db
      .select({ recipientName: orders.recipientName, marketplaceId: orders.marketplaceId })
      .from(orders).where(eq(orders.id, shipment.orderId)).limit(1)

    await db.insert(scanLogs).values({
      userId: workspaceUserId,
      shipmentId: shipment.id,
      orderId: shipment.orderId,
      trackingNumber,
      status: 'duplicate',
    })

    return NextResponse.json({
      status: 'duplicate',
      message: '중복입니다',
      tts: '중복입니다',
      order: order ?? null,
    })
  }

  // 정상: 출고 처리 + 주문 상태를 출고준비(ready)로 전환
  // 출고대기(preparing) 상태일 때만 ready로 승격 (이미 ready 이상이면 변경 없음)
  const now = new Date()
  const pendingShipmentIds = pendingShipments.map((shipment) => shipment.id)
  const pendingOrderIds = pendingShipments.map((shipment) => shipment.orderId)
  await db
    .update(shipments)
    .set({
      shippedAt: now,
      uploadStatus: 'pending',
      updatedAt: now,
    })
    .where(inArray(shipments.id, pendingShipmentIds))

  await db
    .update(orders)
    .set({ status: 'ready', updatedAt: now })
    .where(and(inArray(orders.id, pendingOrderIds), eq(orders.status, 'preparing')))

  await db.insert(scanLogs).values(
    pendingShipments.map((shipment) => ({
      userId: workspaceUserId,
      shipmentId: shipment.id,
      orderId: shipment.orderId,
      trackingNumber,
      status: 'ok',
    })),
  )

  const primaryShipment = pendingShipments[0]

  // Fetch order + item info for display
  const [order] = await db
    .select({
      id: orders.id,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
    })
    .from(orders).where(eq(orders.id, primaryShipment.orderId)).limit(1)

  const items = order
    ? await db.select({ productName: orderItems.productName, quantity: orderItems.quantity })
        .from(orderItems).where(eq(orderItems.orderId, order.id))
    : []

  // Today's scan count (after this scan)
  const todayCount = body.includeTodayCount === false
    ? null
    : await db
      .select({ value: count() })
      .from(shipments)
      .where(
        and(
          eq(shipments.userId, workspaceUserId),
          gte(shipments.shippedAt, todayStart),
        ),
      )

  return NextResponse.json({
    status: 'ok',
    message: '정상입니다',
    tts: '정상입니다',
    trackingNumber,
    carrierId: primaryShipment.carrierId,
    carrierName: primaryShipment.carrierName,
    order: order ?? null,
    items,
    todayCount: todayCount ? Number(todayCount[0]?.value ?? 0) : undefined,
    processedCount: pendingShipments.length,
  })
}
