/**
 * POST /api/shipping/split
 *
 * 하나의 주문을 여러 개의 송장(shipment)으로 분리 출고한다.
 * 기존 1 order → 1 shipment 관계를 1 order → N shipment 로 확장.
 *
 * Body:
 *   {
 *     orderId: string,
 *     shipments: Array<{
 *       trackingNumber: string,
 *       carrierId: string,
 *       carrierName: string,
 *       items?: Array<{ orderItemId: string; quantity: number }>  // 생략 시 송장에 item 연결 없음
 *     }>
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, shipments, shipmentItems } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { lockOrderItemsForOrders } from '@/lib/orders/locking'

interface SplitEntry {
  trackingNumber: string
  carrierId: string
  carrierName: string
  items?: Array<{ orderItemId: string; quantity: number }>
}

interface SplitBody {
  orderId: string
  shipments: SplitEntry[]
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: SplitBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.orderId || !Array.isArray(body.shipments) || body.shipments.length === 0) {
    return NextResponse.json({ error: 'orderId와 shipments 필수' }, { status: 400 })
  }

  // 중복/빈값 검증
  const trackingNumbers = body.shipments.map((s) => (s.trackingNumber ?? '').trim())
  if (trackingNumbers.some((t) => !t)) {
    return NextResponse.json({ error: '모든 송장번호를 입력하세요' }, { status: 400 })
  }
  if (new Set(trackingNumbers).size !== trackingNumbers.length) {
    return NextResponse.json({ error: '송장번호 중복' }, { status: 400 })
  }

  // 주문 소유권 확인
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, body.orderId), eq(orders.userId, workspaceUserId)))
    .limit(1)
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // 트랜잭션: 송장 N개 + 각각의 items + 출고 스냅샷 잠금
  const createdIds = await db.transaction(async (tx) => {
    const ids: string[] = []
    for (const entry of body.shipments) {
      const [created] = await tx
        .insert(shipments)
        .values({
          orderId: body.orderId,
          userId: workspaceUserId,
          trackingNumber: entry.trackingNumber.trim(),
          carrierId: entry.carrierId,
          carrierName: entry.carrierName,
        })
        .returning({ id: shipments.id })

      ids.push(created.id)

      if (entry.items && entry.items.length > 0) {
        await tx.insert(shipmentItems).values(
          entry.items
            .filter((it) => it.quantity > 0)
            .map((it) => ({
              shipmentId: created.id,
              orderItemId: it.orderItemId,
              quantity: it.quantity,
            })),
        )
      }
    }
    await tx
      .update(orders)
      .set({ status: 'shipped', updatedAt: new Date() })
      .where(eq(orders.id, body.orderId))
    await lockOrderItemsForOrders(tx, workspaceUserId, [body.orderId], user.id)
    return ids
  })

  return NextResponse.json({ created: createdIds.length, shipmentIds: createdIds })
}
