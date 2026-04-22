/**
 * GET /api/orders/[id]/memos — list memos for this order (newest first)
 * POST /api/orders/[id]/memos — add a memo { content, memoType? }
 *
 * Both verify the order belongs to the authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orderMemos, orders } from '@/lib/db/schema'

async function verifyOrderOwnership(orderId: string, userId: string) {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1)
  return !!row
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await verifyOrderOwnership(id, user.id))) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  }

  const memos = await db
    .select()
    .from(orderMemos)
    .where(eq(orderMemos.orderId, id))
    .orderBy(desc(orderMemos.createdAt))

  return NextResponse.json({ memos })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await verifyOrderOwnership(id, user.id))) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  }

  const body = (await req.json()) as { content?: string; memoType?: string }
  const content = body.content?.trim()
  if (!content) {
    return NextResponse.json({ error: '메모 내용을 입력하세요.' }, { status: 400 })
  }

  const [created] = await db
    .insert(orderMemos)
    .values({
      orderId: id,
      userId: user.id,
      content,
      memoType: body.memoType?.trim() || 'general',
    })
    .returning()

  return NextResponse.json({ memo: created })
}
