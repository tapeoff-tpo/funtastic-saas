/**
 * GET /api/orders/[id] — full order detail for the dialog.
 * Scoped by authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOrderById } from '@/lib/orders/queries'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { db } from '@/lib/db'
import { orderItems, orders } from '@/lib/db/schema'
import { logOrderChange } from '@/lib/orders/change-log'
import { and, eq, inArray } from 'drizzle-orm'

const EDITABLE_CONFIRMED_ITEM_STATUSES = new Set(['new', 'confirmed', 'preparing', 'ready'])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const order = await getOrderById(id, await getWorkspaceUserId(user.id))
  if (!order) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ order })
}

type ItemUpdate = {
  id?: unknown
  productName?: unknown
  optionName?: unknown
  quantity?: unknown
  sku?: unknown
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceUserId = await getWorkspaceUserId(user.id)

  let body: { items?: ItemUpdate[] }
  try {
    body = await req.json() as { items?: ItemUpdate[] }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updates = Array.isArray(body.items) ? body.items : []
  if (updates.length === 0) {
    return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 })
  }

  const normalized = updates.map((item) => {
    const itemId = typeof item.id === 'string' ? item.id.trim() : ''
    const productName = typeof item.productName === 'string' ? item.productName.trim() : ''
    const optionName = typeof item.optionName === 'string' ? item.optionName.trim() : ''
    const sku = typeof item.sku === 'string' ? item.sku.trim() : ''
    const quantity = Number(item.quantity)
    return {
      id: itemId,
      productName,
      optionName: optionName || null,
      sku: sku || null,
      quantity,
    }
  })

  const invalid = normalized.find((item) => (
    !item.id ||
    !item.productName ||
    !Number.isInteger(item.quantity) ||
    item.quantity < 1
  ))
  if (invalid) {
    return NextResponse.json(
      { error: '확정상품명과 1 이상의 정수 수량을 입력해주세요.' },
      { status: 400 },
    )
  }

  const [order] = await db
    .select({ id: orders.id, status: orders.status })
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, workspaceUserId)))
    .limit(1)

  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!EDITABLE_CONFIRMED_ITEM_STATUSES.has(order.status)) {
    return NextResponse.json(
      { error: '출고완료 이후 주문은 확정상품 정보를 수정할 수 없습니다.' },
      { status: 409 },
    )
  }

  const itemIds = normalized.map((item) => item.id)
  const existingItems = await db
    .select({
      id: orderItems.id,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      quantity: orderItems.quantity,
      lockedProductName: orderItems.lockedProductName,
      lockedOptionName: orderItems.lockedOptionName,
      lockedQuantity: orderItems.lockedQuantity,
    })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, id), inArray(orderItems.id, itemIds)))

  if (existingItems.length !== normalized.length) {
    return NextResponse.json({ error: '주문에 포함되지 않은 상품이 있습니다.' }, { status: 400 })
  }

  const existingById = new Map(existingItems.map((item) => [item.id, item]))
  const before = normalized.map((item) => {
    const existing = existingById.get(item.id)!
    return {
      id: existing.id,
      productName: existing.lockedProductName ?? existing.productName,
      optionName: existing.lockedOptionName ?? existing.optionText,
      quantity: existing.lockedQuantity ?? existing.quantity,
    }
  })
  const after = normalized.map((item) => ({
    id: item.id,
    productName: item.productName,
    optionName: item.optionName,
    sku: item.sku,
    quantity: item.quantity,
  }))

  await db.transaction(async (tx) => {
    for (const item of normalized) {
      await tx
        .update(orderItems)
        .set({
          lockedProductName: item.productName,
          lockedOptionName: item.optionName,
          lockedQuantity: item.quantity,
          lockedSku: item.sku,
          lockedAt: new Date(),
          lockedByUserId: user.id,
        })
        .where(and(eq(orderItems.id, item.id), eq(orderItems.orderId, id)))
    }

    await tx
      .update(orders)
      .set({ updatedAt: new Date() })
      .where(eq(orders.id, id))

    await logOrderChange({
      orderId: id,
      userId: workspaceUserId,
      actorId: user.id,
      action: 'items.confirmed_updated',
      title: '확정상품 수정',
      description: '주문 상세창에서 확정상품, 확정옵션, 수량을 수정했습니다.',
      before: { items: before },
      after: { items: after },
    }, tx)
  })

  const refreshed = await getOrderById(id, workspaceUserId)
  return NextResponse.json({ order: refreshed })
}
