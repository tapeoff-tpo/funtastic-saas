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
import { shipments, orders, orderItems } from '@/lib/db/schema'
import { eq, and, gte, count } from 'drizzle-orm'
import { startOfDay } from 'date-fns'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { trackingNumber: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const trackingNumber = body.trackingNumber?.trim()
  if (!trackingNumber) {
    return NextResponse.json({ error: '운송장번호 없음' }, { status: 400 })
  }

  // Look up shipment
  const [shipment] = await db
    .select({
      id: shipments.id,
      orderId: shipments.orderId,
      carrierId: shipments.carrierId,
      carrierName: shipments.carrierName,
      shippedAt: shipments.shippedAt,
      uploadStatus: shipments.uploadStatus,
    })
    .from(shipments)
    .where(eq(shipments.trackingNumber, trackingNumber))
    .limit(1)

  // 비정상: 시스템에 없는 운송장
  if (!shipment) {
    return NextResponse.json({
      status: 'not_found',
      message: '비정상입니다',
      tts: '비정상입니다',
    })
  }

  // 중복: 오늘 이미 스캔됨
  const todayStart = startOfDay(new Date())
  if (shipment.shippedAt && new Date(shipment.shippedAt) >= todayStart) {
    // Fetch order info for display
    const [order] = await db
      .select({ recipientName: orders.recipientName, marketplaceId: orders.marketplaceId })
      .from(orders).where(eq(orders.id, shipment.orderId)).limit(1)

    return NextResponse.json({
      status: 'duplicate',
      message: '중복입니다',
      tts: '중복입니다',
      order: order ?? null,
    })
  }

  // 정상: 출고 처리 + 주문 상태를 출고준비(ready)로 전환
  // 출고대기(preparing) 상태일 때만 ready로 승격 (이미 ready 이상이면 변경 없음)
  await db
    .update(shipments)
    .set({
      shippedAt: new Date(),
      uploadStatus: 'pending',
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, shipment.id))

  await db
    .update(orders)
    .set({ status: 'ready', updatedAt: new Date() })
    .where(and(eq(orders.id, shipment.orderId), eq(orders.status, 'preparing')))

  // Fetch order + item info for display
  const [order] = await db
    .select({
      id: orders.id,
      recipientName: orders.recipientName,
      recipientPhone: orders.recipientPhone,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
    })
    .from(orders).where(eq(orders.id, shipment.orderId)).limit(1)

  const items = order
    ? await db.select({ productName: orderItems.productName, quantity: orderItems.quantity })
        .from(orderItems).where(eq(orderItems.orderId, order.id))
    : []

  // Today's scan count (after this scan)
  const [{ value: todayCount }] = await db
    .select({ value: count() })
    .from(shipments)
    .where(
      and(
        eq(shipments.userId, user.id),
        gte(shipments.shippedAt, todayStart),
      ),
    )

  return NextResponse.json({
    status: 'ok',
    message: '정상입니다',
    tts: '정상입니다',
    trackingNumber,
    carrierId: shipment.carrierId,
    carrierName: shipment.carrierName,
    order: order ?? null,
    items,
    todayCount: Number(todayCount),
  })
}
