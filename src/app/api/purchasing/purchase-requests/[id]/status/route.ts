import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  updatePurchaseRequestStatus,
} from '@/lib/purchasing/purchase-requests'
import { PURCHASE_REQUEST_STATUS_LABELS } from '@/lib/purchasing/purchase-request-status'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  status: z.enum(['requested', 'purchased', 'purchase_completed', 'china_arrived', 'outbound_requested', 'completed']),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const { id } = await params
  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '변경할 진행상태가 올바르지 않습니다.' }, { status: 400 })
  }

  let row: Awaited<ReturnType<typeof updatePurchaseRequestStatus>>
  try {
    row = await updatePurchaseRequestStatus({
      userId: await getWorkspaceUserId(user.id),
      id,
      status: body.data.status,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '진행상태 변경에 실패했습니다.' },
      { status: 409 },
    )
  }

  if (!row) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({
    id: row.id,
    status: body.data.status,
    label: PURCHASE_REQUEST_STATUS_LABELS[body.data.status],
  })
}
