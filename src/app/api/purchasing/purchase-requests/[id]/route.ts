import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  deletePurchaseRequestItem,
  updatePurchaseRequestPlanFields,
} from '@/lib/purchasing/purchase-requests'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  requestedQuantity: z.number().int().min(1).max(1_000_000).optional(),
  supplierOrderNumber: z.string().max(100).nullable().optional(),
  outboundExpectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purchaseMethod: z.string().max(100).nullable().optional(),
  purchaseConfirmed: z.boolean().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '저장할 발주 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  const { id } = await params
  const row = await updatePurchaseRequestPlanFields({
    userId: await getWorkspaceUserId(user.id),
    id,
    ...body.data,
  })

  if (!row) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ id: row.id })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const { id } = await params
  const row = await deletePurchaseRequestItem({
    userId: await getWorkspaceUserId(user.id),
    id,
  })

  if (!row) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ id: row.id })
}
