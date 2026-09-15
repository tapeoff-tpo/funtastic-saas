import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { updatePurchaseRequestBulkPaymentDeposit } from '@/lib/purchasing/purchase-requests'
import { createClient } from '@/lib/supabase/server'

const calendarDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day
  }, '올바른 지급일을 입력해주세요.')

export const bulkPaymentDepositBodySchema = z.object({
  depositCny: z.number().finite().min(0).max(100_000_000),
  depositPaidAt: calendarDateSchema.nullable(),
  depositMemo: z.string().trim().max(500).nullable(),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bulkPaymentDepositBodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({
      error: body.error.issues[0]?.message ?? '선금 정보가 올바르지 않습니다.',
    }, { status: 400 })
  }

  const { id } = await params
  try {
    const row = await updatePurchaseRequestBulkPaymentDeposit({
      userId: await getWorkspaceUserId(user.id),
      id,
      ...body.data,
    })
    if (!row) {
      return NextResponse.json({ error: '대량결제대기 항목을 찾을 수 없습니다.' }, { status: 404 })
    }
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '선금 정보를 저장하지 못했습니다.',
    }, { status: 400 })
  }

  revalidatePath('/purchasing/orders')
  revalidatePath('/purchasing/payment-flow')
  return NextResponse.json({ id })
}
