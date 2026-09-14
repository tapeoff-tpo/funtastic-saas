import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { completeOutstandingPurchaseRequestItems } from '@/lib/purchasing/purchase-requests'
import { createClient } from '@/lib/supabase/server'

export const purchaseRequestBulkCompleteBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
}).strict()

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = purchaseRequestBulkCompleteBodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '완료 처리할 결제 대기 항목이 올바르지 않습니다.' }, { status: 400 })
  }

  const result = await completeOutstandingPurchaseRequestItems({
    userId: await getWorkspaceUserId(user.id),
    ids: body.data.ids,
  })

  revalidatePath('/purchasing/overdue')
  revalidatePath('/purchasing/purchases')
  revalidatePath('/purchasing/orders')
  revalidatePath('/purchasing/payment-flow')
  revalidatePath('/costs')

  return NextResponse.json({
    completedIds: result.completedIds,
    completedCount: result.completedIds.length,
    ineligibleIds: result.ineligibleIds,
    ineligibleCount: result.ineligibleIds.length,
    missingIds: result.missingIds,
    missingCount: result.missingIds.length,
  })
}
