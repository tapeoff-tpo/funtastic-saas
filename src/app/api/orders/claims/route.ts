import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { claims, orders } from '@/lib/db/schema'
import type { ClaimType } from '@/lib/orders/types'
import { copyOrder } from '@/lib/orders/copy-order'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

const VALID_TYPES = ['return', 'exchange'] as const
const REASON_LABELS = {
  change_of_mind: '변심',
  wrong_delivery: '오배송',
  defective: '불량',
  other: '기타사유',
} as const
type ClaimReasonCode = keyof typeof REASON_LABELS

interface CreateClaimBody {
  orderId?: string
  claimType?: ClaimType
  reasonCode?: ClaimReasonCode
  reasonDetail?: string | null
  quantities?: Array<{ orderItemId: string; quantity: number }>
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)

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
  if (!body.reasonCode || !(body.reasonCode in REASON_LABELS)) {
    return NextResponse.json({ error: '클레임 사유를 선택해주세요.' }, { status: 400 })
  }

  const claimQuantities = (body.quantities ?? [])
    .map((item) => ({
      orderItemId: item.orderItemId,
      quantity: Math.max(0, Math.floor(Number(item.quantity))),
    }))
    .filter((item) => item.orderItemId && item.quantity > 0)
  if (claimQuantities.length === 0) {
    return NextResponse.json({ error: '접수 수량을 1개 이상 입력해주세요.' }, { status: 400 })
  }

  const [order] = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      marketplaceId: orders.marketplaceId,
      marketplaceOrderId: orders.marketplaceOrderId,
      internalNo: orders.internalNo,
    })
    .from(orders)
    .where(and(eq(orders.id, body.orderId), eq(orders.userId, workspaceUserId)))
    .limit(1)

  if (!order) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 })

  const reasonLabel = REASON_LABELS[body.reasonCode]
  const detail = body.reasonDetail?.trim()
  const reason = detail ? `${reasonLabel} - ${detail}` : reasonLabel
  const marketplaceClaimId = `manual-${body.claimType}-${order.id}`

  const [existingClaim] = await db
    .select({ id: claims.id })
    .from(claims)
    .where(and(
      eq(claims.marketplaceId, order.marketplaceId),
      eq(claims.marketplaceClaimId, marketplaceClaimId),
      eq(claims.userId, workspaceUserId),
    ))
    .limit(1)
  if (existingClaim) {
    return NextResponse.json({ error: '이미 접수된 클레임입니다.' }, { status: 409 })
  }

  const [created] = await db
    .insert(claims)
    .values({
      orderId: order.id,
      userId: workspaceUserId,
      marketplaceId: order.marketplaceId,
      marketplaceClaimId,
      claimType: body.claimType,
      claimStatus: 'requested',
      reason,
      rawData: {
        source: 'manual',
        marketplaceOrderId: order.marketplaceOrderId,
        reasonCode: body.reasonCode,
        reasonDetail: detail ?? null,
        quantities: claimQuantities,
      },
      requestedAt: new Date(),
    })
    .returning({ id: claims.id })

  const copies: Array<{ id: string; kind: 'return-pickup' | 'exchange-pickup' | 'exchange-reship' }> = []
  if (body.claimType === 'return') {
    const pickup = await copyOrder(order.id, workspaceUserId, {
      status: 'confirmed',
      logisticsMessage: `반품회수준비 / ${reason} / 원주문 ${order.internalNo}`,
      itemQuantities: claimQuantities,
      rawData: {
        source: 'manual-return-pickup',
        originalOrderId: order.id,
        claimId: created.id,
        reasonCode: body.reasonCode,
      },
    })
    if (!pickup.success || !pickup.newOrderId) {
      return NextResponse.json({ error: pickup.error ?? '반품회수준비 주문 생성 실패' }, { status: 500 })
    }
    copies.push({ id: pickup.newOrderId, kind: 'return-pickup' })
  }

  if (body.claimType === 'exchange') {
    const pickup = await copyOrder(order.id, workspaceUserId, {
      status: 'confirmed',
      logisticsMessage: `교환회수준비 / ${reason} / 원주문 ${order.internalNo}`,
      itemQuantities: claimQuantities,
      rawData: {
        source: 'manual-exchange-pickup',
        originalOrderId: order.id,
        claimId: created.id,
        reasonCode: body.reasonCode,
      },
    })
    if (!pickup.success || !pickup.newOrderId) {
      return NextResponse.json({ error: pickup.error ?? '교환회수준비 주문 생성 실패' }, { status: 500 })
    }
    copies.push({ id: pickup.newOrderId, kind: 'exchange-pickup' })

    const reship = await copyOrder(order.id, workspaceUserId, {
      status: 'confirmed',
      logisticsMessage: `교환발송준비 / ${reason} / 원주문 ${order.internalNo}`,
      itemQuantities: claimQuantities,
      rawData: {
        source: 'manual-exchange-reship',
        originalOrderId: order.id,
        claimId: created.id,
        reasonCode: body.reasonCode,
      },
    })
    if (!reship.success || !reship.newOrderId) {
      return NextResponse.json({ error: reship.error ?? '교환발송준비 주문 생성 실패' }, { status: 500 })
    }
    copies.push({ id: reship.newOrderId, kind: 'exchange-reship' })
  }

  return NextResponse.json({ id: created.id, copies })
}
