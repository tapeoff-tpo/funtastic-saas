/**
 * POST /api/orders/apply-mappings
 *
 * 선택된 주문(orderIds)들을 "매핑완료" 상태로 마크.
 * - orders.mapped_at = now()
 * - orders.mapped_by_user_id = current user
 *
 * 사방넷 워크플로우의 "매핑완료처리" 에 해당. 별도 status 변경은 없고
 * 단지 mapped_at 만 기록한다 (status='new' 그대로 유지). 이 시점은 추후
 * 출고준비(preparing) 전환 / 발주확인 시 사용된다.
 *
 * Body: { orderIds: string[] }
 * Returns: { applied: number }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { and, eq, inArray } from 'drizzle-orm'
import { logOrderChanges } from '@/lib/orders/change-log'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: { orderIds?: string[] }
  try {
    body = await req.json() as { orderIds?: string[] }
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const orderIds = Array.isArray(body.orderIds)
    ? body.orderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []

  if (orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds must be a non-empty array' }, { status: 400 })
  }

  const result = await db
    .update(orders)
    .set({
      mappedAt: new Date(),
      mappedByUserId: user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.userId, workspaceUserId), inArray(orders.id, orderIds)))
    .returning({ id: orders.id, mappedAt: orders.mappedAt })

  await logOrderChanges(result.map((order) => ({
    orderId: order.id,
    userId: workspaceUserId,
    actorId: user.id,
    action: 'mapping.applied',
    title: '매핑완료',
    description: '주문 매핑이 완료 처리되었습니다.',
    after: { mappedAt: order.mappedAt },
  })))

  return NextResponse.json({ applied: result.length })
}
