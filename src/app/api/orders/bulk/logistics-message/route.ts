/**
 * POST /api/orders/bulk/logistics-message
 * Body: { orderIds: string[], message: string | null }
 *
 * Sets or clears logisticsMessage on multiple orders (scoped by userId).
 * Empty-string / null message clears the field.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { orderIds?: string[]; message?: string | null }

  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds가 필요합니다.' }, { status: 400 })
  }

  const cleaned = body.message?.trim() || null

  const updated = await db
    .update(orders)
    .set({ logisticsMessage: cleaned, updatedAt: new Date() })
    .where(
      and(eq(orders.userId, user.id), inArray(orders.id, body.orderIds)),
    )
    .returning({ id: orders.id })

  return NextResponse.json({ updated: updated.length })
}
