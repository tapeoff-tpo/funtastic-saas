import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  deletePurchaseRequestItem,
  updatePurchaseRequestPlanFields,
} from '@/lib/purchasing/purchase-requests'
import { PURCHASE_DELAY_REASONS } from '@/lib/purchasing/purchase-delay'
import { PURCHASE_PAYMENT_STATUSES } from '@/lib/purchasing/purchase-request-status'
import { createClient } from '@/lib/supabase/server'

export const purchaseRequestPlanFieldsBodySchema = z.object({
  requestedQuantity: z.number().int().min(1).max(1_000_000).optional(),
  actualPurchaseQuantity: z.number().int().min(0).max(1_000_000).optional(),
  chinaReceivedQuantity: z.number().int().min(0).max(1_000_000).optional(),
  outboundRequestedQuantity: z.number().int().min(0).max(1_000_000).optional(),
  supplierOrderNumber: z.string().max(100).nullable().optional(),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  outboundExpectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purchaseMethod: z.string().max(100).nullable().optional(),
  purchaseConfirmed: z.boolean().optional(),
  paymentStatus: z.enum(PURCHASE_PAYMENT_STATUSES).optional(),
  bulkPaymentPending: z.boolean().optional(),
  bulkPaymentDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  buyerCode: z.enum(['1', '2', '3', '4', '5']).nullable().optional(),
  buyerName: z.string().max(100).nullable().optional(),
  delayReason: z.enum(PURCHASE_DELAY_REASONS).nullable().optional(),
  delayNote: z.string().trim().max(2_000).nullable().optional(),
  applyDelayReasonToItem: z.boolean().optional(),
  // An explicit opt-in marker only. The purchasing service merges this into
  // rawData so the existing Ecount/raw China-inventory path remains untouched.
  saasChinaMode: z.boolean().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = purchaseRequestPlanFieldsBodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '저장할 발주 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  const { id } = await params
  let row: Awaited<ReturnType<typeof updatePurchaseRequestPlanFields>>
  try {
    row = await updatePurchaseRequestPlanFields({
      userId: await getWorkspaceUserId(user.id),
      id,
      ...body.data,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '발주 정보 저장에 실패했습니다.' },
      { status: 409 },
    )
  }

  if (!row) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
  revalidatePath('/purchasing/overdue')
  revalidatePath('/purchasing/purchases')
  revalidatePath('/purchasing/orders')
  revalidatePath('/purchasing/payment-flow')
  revalidatePath('/purchasing/saas-china-inventory')
  revalidatePath('/purchasing/china-shipments')
  revalidatePath('/costs')
  return NextResponse.json({ id: row.id, excludedRecommendationCount: row.excludedRecommendationCount })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const { id } = await params
  let row: Awaited<ReturnType<typeof deletePurchaseRequestItem>>
  try {
    row = await deletePurchaseRequestItem({
      userId: await getWorkspaceUserId(user.id),
      id,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '발주 항목 삭제에 실패했습니다.' },
      { status: 409 },
    )
  }

  if (!row) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
  revalidatePath('/purchasing/payment-flow')
  return NextResponse.json({ id: row.id })
}
