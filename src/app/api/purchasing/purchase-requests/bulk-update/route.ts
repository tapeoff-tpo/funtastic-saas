import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { updatePurchaseRequestPlanFieldsBulk } from '@/lib/purchasing/purchase-requests'
import { createClient } from '@/lib/supabase/server'

const calendarDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day
  }, '올바른 날짜를 입력해주세요.')

export const purchaseRequestBulkUpdateBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  buyerCode: z.enum(['1', '2', '3', '4', '5']).nullable().optional(),
  bulkPaymentPending: z.boolean().optional(),
  bulkPaymentDueDate: calendarDateSchema.nullable().optional(),
}).strict().superRefine((body, context) => {
  if (body.buyerCode === undefined && body.bulkPaymentPending === undefined) {
    context.addIssue({
      code: 'custom',
      message: '변경할 값이 없습니다.',
    })
  }
  if (body.bulkPaymentDueDate !== undefined && body.bulkPaymentPending === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['bulkPaymentDueDate'],
      message: '예정일을 변경하려면 대량결제대기 여부도 함께 지정해야 합니다.',
    })
  }
  if (body.bulkPaymentPending === false && body.bulkPaymentDueDate) {
    context.addIssue({
      code: 'custom',
      path: ['bulkPaymentDueDate'],
      message: '대량결제대기 해제 시 예정일을 지정할 수 없습니다.',
    })
  }
})

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = purchaseRequestBulkUpdateBodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({
      error: body.error.issues[0]?.message ?? '전체 적용할 값이 올바르지 않습니다.',
    }, { status: 400 })
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const updated = await updatePurchaseRequestPlanFieldsBulk({
    userId: workspaceUserId,
    ids: body.data.ids,
    buyerCode: body.data.buyerCode,
    bulkPaymentPending: body.data.bulkPaymentPending,
    bulkPaymentDueDate: body.data.bulkPaymentDueDate,
  })

  revalidatePath('/purchasing/overdue')
  revalidatePath('/purchasing/purchases')
  revalidatePath('/purchasing/orders')
  revalidatePath('/purchasing/payment-flow')
  revalidatePath('/costs')

  return NextResponse.json({
    updatedIds: updated.map((row) => row.id),
    updatedCount: updated.length,
    ignoredCount: Math.max(0, new Set(body.data.ids).size - updated.length),
  })
}
