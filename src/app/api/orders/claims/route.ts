import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { claims, orders } from '@/lib/db/schema'
import type { ClaimType } from '@/lib/orders/types'

const VALID_TYPES = ['return', 'exchange'] as const

interface CreateClaimBody {
  orderId?: string
  claimType?: ClaimType
  reason?: string | null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: CreateClaimBody
  try {
    body = await req.json() as CreateClaimBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  if (!body.orderId) return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  if (!body.claimType || !VALID_TYPES.includes(body.claimType as (typeof VALID_TYPES)[number])) {
    return NextResponse.json({ error: '반품 또는 교환만 접수할 수 있습니다.' }, { status: 400 })
  }

  const [order] = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
    })
    .from(orders)
    .where(and(eq(orders.id, body.orderId), eq(orders.userId, user.id)))
    .limit(1)

  if (!order) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })

  const marketplaceClaimId = `manual-${body.claimType}-${order.id}`
  const [created] = await db
    .insert(claims)
    .values({
      orderId: order.id,
      userId: user.id,
      marketplaceId: order.marketplaceId,
      marketplaceClaimId,
      claimType: body.claimType,
      claimStatus: 'requested',
      reason: body.reason?.trim() || null,
      rawData: {
        source: 'manual',
        marketplaceOrderId: order.marketplaceOrderId,
      },
      requestedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [claims.marketplaceId, claims.marketplaceClaimId],
      set: {
        claimStatus: 'requested',
        reason: body.reason?.trim() || null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: claims.id })

  return NextResponse.json({ id: created.id })
}
