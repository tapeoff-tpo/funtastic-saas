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
import { createClient } from '@/lib/auth/server'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'

const price = z.number().min(0).max(999_999_999)
  .refine((value) => Math.abs(value - Math.round(value * 100) / 100) < 0.0000001)
  .nullable().optional()

export const purchaseRequestPlanFieldsBodySchema = z.object({
  requestedQuantity: z.number().int().min(1).max(1_000_000).optional(),
  actualPurchaseQuantity: z.number().int().min(0).max(1_000_000).optional(),
  chinaReceivedQuantity: z.number().int().min(0).max(1_000_000).optional(),
  outboundRequestedQuantity: z.number().int().min(0).max(1_000_000).optional(),
  supplierOrderNumber: z.string().max(100).nullable().optional(),
  trackingNumber: z.string().trim().max(100).nullable().optional(),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  outboundExpectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purchaseMethod: z.string().max(100).nullable().optional(),
  purchasePriceComparison: z.object({
    actualUnitPriceCny: price,
    actualShippingCny: price,
  }).strict().refine((values) => Object.keys(values).length > 0).optional(),
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
  if (body.data.purchasePriceComparison) {
    const access = await getUserMenuAccess(user.id)
    if (!access || !canUseMenu(access, '/purchasing/orders')) {
      return NextResponse.json({ error: '구매가격을 수정할 권한이 없습니다.' }, { status: 403 })
    }
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
  const paymentFlowChanged = body.data.supplierOrderNumber !== undefined
    || body.data.requestedQuantity !== undefined
    || body.data.actualPurchaseQuantity !== undefined
    || body.data.paymentStatus !== undefined
    || body.data.bulkPaymentPending !== undefined
    || body.data.bulkPaymentDueDate !== undefined
  if (paymentFlowChanged) {
    revalidatePath('/purchasing/payment-flow')
    revalidatePath('/costs')
  }
  const chinaOutboundChanged = body.data.saasChinaMode !== undefined
    || body.data.chinaReceivedQuantity !== undefined
    || body.data.outboundRequestedQuantity !== undefined
  if (chinaOutboundChanged) {
    revalidatePath('/purchasing/saas-china-inventory')
    revalidatePath('/purchasing/china-shipments')
  }
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
