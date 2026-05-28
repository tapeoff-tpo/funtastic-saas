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
import { eq, and, gte, count, isNull, or, inArray, sql } from 'drizzle-orm'
import { startOfDay } from 'date-fns'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { deductForOrder } from '@/lib/inventory/actions'
import { logOrderChange } from '@/lib/orders/change-log'
import { isExchangeReshipOrder } from '@/lib/orders/exchange-reship'

function normalizeTrackingNumber(value: string) {
  return value.trim().replace(/[^0-9A-Za-z]/g, '')
}

function normalizedTrackingNumberSql() {
  return sql<string>`regexp_replace(${shipments.trackingNumber}, '[^0-9A-Za-z]', '', 'g')`
}

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

  const rawScanValue = String(body.trackingNumber ?? '').trim()
  const scanValue = normalizeTrackingNumber(rawScanValue)
  if (!scanValue) {
    return NextResponse.json({ error: '운송장번호 없음' }, { status: 400 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  // Look up all shipments for this tracking number. 등록된 송장번호는
  // 여러 주문에 연결되어 있어도 함께 출고 처리한다. 취소/미발송/물류메세지
  // 같은 명시적 보류 신호만 비정상으로 막는다.
  const shipmentSelect = {
    id: shipments.id,
    orderId: shipments.orderId,
    trackingNumber: shipments.trackingNumber,
    carrierId: shipments.carrierId,
    carrierName: shipments.carrierName,
    shippedAt: shipments.shippedAt,
    uploadStatus: shipments.uploadStatus,
    orderStatus: orders.status,
    isHeld: orders.isHeld,
    logisticsMessage: orders.logisticsMessage,
    marketplaceStatus: orders.marketplaceStatus,
    marketplaceId: orders.marketplaceId,
    marketplaceOrderId: orders.marketplaceOrderId,
  }

  const exactTrackingShipments = await db
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
      logisticsMessage: orders.logisticsMessage,
      marketplaceStatus: orders.marketplaceStatus,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
    })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .where(and(
      eq(shipments.userId, workspaceUserId),
      eq(normalizedTrackingNumberSql(), scanValue),
    ))

  const matchingShipments = exactTrackingShipments.length > 0
    ? exactTrackingShipments
    : await db
      .select(shipmentSelect)
      .from(shipments)
      .innerJoin(orders, eq(orders.id, shipments.orderId))
      .where(and(
        eq(shipments.userId, workspaceUserId),
        or(
          eq(orders.marketplaceOrderId, rawScanValue),
          eq(orders.marketplaceOrderId, scanValue),
          eq(orders.internalNo, rawScanValue),
          eq(orders.internalNo, scanValue),
        ),
      ))

  // 비정상: 시스템에 없는 운송장
  if (matchingShipments.length === 0) {
    // 비정상 스캔도 이력으로 남김 (shipment_id/order_id = null)
    await db.insert(scanLogs).values({
      userId: workspaceUserId,
      shipmentId: null,
      orderId: null,
      trackingNumber: scanValue,
      status: 'not_found',
    })
    return NextResponse.json({
      status: 'not_found',
      message: '비정상입니다',
      tts: '비정상입니다',
    })
  }

  const matchedTrackingNumber = normalizeTrackingNumber(matchingShipments[0]?.trackingNumber ?? scanValue)
  const groupedShipments = matchingShipments
  const invalidGroup = groupedShipments.filter((shipment) =>
    shipment.isHeld || shipment.orderStatus === 'cancelled' || Boolean(shipment.logisticsMessage?.trim()),
  )
  if (invalidGroup.length > 0) {
    await db.insert(scanLogs).values(
      groupedShipments.map((shipment) => ({
        userId: workspaceUserId,
        shipmentId: shipment.id,
        orderId: shipment.orderId,
        trackingNumber: matchedTrackingNumber,
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
      trackingNumber: matchedTrackingNumber,
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
  const exchangeReshipOrderIds = Array.from(new Set(
    pendingShipments
      .filter((shipment) => isExchangeReshipOrder(shipment.marketplaceStatus))
      .map((shipment) => shipment.orderId),
  ))
  const exchangeReshipOrderIdSet = new Set(exchangeReshipOrderIds)
  const regularPendingOrderIds = pendingOrderIds.filter((orderId) => !exchangeReshipOrderIdSet.has(orderId))

  await db.transaction(async (tx) => {
    await tx
      .update(shipments)
      .set({
        shippedAt: now,
        uploadStatus: 'pending',
        updatedAt: now,
      })
      .where(inArray(shipments.id, pendingShipmentIds))

    if (regularPendingOrderIds.length > 0) {
      await tx
        .update(orders)
        .set({ status: 'ready', updatedAt: now })
        .where(and(inArray(orders.id, regularPendingOrderIds), eq(orders.status, 'preparing')))
    }

    if (exchangeReshipOrderIds.length > 0) {
      const exchangeOrders = await tx
        .select({ id: orders.id, status: orders.status, userId: orders.userId })
        .from(orders)
        .where(inArray(orders.id, exchangeReshipOrderIds))
        .for('update')

      for (const order of exchangeOrders) {
        if (order.status === 'shipped' || order.status === 'cancelled') continue
        await tx.update(orders).set({
          status: 'shipped',
          previousStatus: order.status,
          updatedAt: now,
        }).where(eq(orders.id, order.id))
        await logOrderChange({
          orderId: order.id,
          userId: order.userId,
          action: 'status.shipped',
          title: '교환발송 출고완료',
          description: '교환발송준비 주문이 바코드 스캔되어 출고완료 처리되었습니다.',
          before: { status: order.status },
          after: { status: 'shipped' },
        }, tx)
        await deductForOrder(tx, order.userId, order.id)
      }
    }
  })

  await db.insert(scanLogs).values(
    pendingShipments.map((shipment) => ({
      userId: workspaceUserId,
      shipmentId: shipment.id,
      orderId: shipment.orderId,
      trackingNumber: matchedTrackingNumber,
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
    trackingNumber: matchedTrackingNumber,
    carrierId: primaryShipment.carrierId,
    carrierName: primaryShipment.carrierName,
    order: order ?? null,
    items,
    todayCount: todayCount ? Number(todayCount[0]?.value ?? 0) : undefined,
    processedCount: pendingShipments.length,
  })
}
