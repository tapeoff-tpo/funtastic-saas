import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  updatePurchaseRequestStatus,
} from '@/lib/purchasing/purchase-requests'
import { PURCHASE_REQUEST_STATUS_LABELS } from '@/lib/purchasing/purchase-request-status'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(['requested', 'purchased', 'purchase_completed', 'china_arrived', 'outbound_requested', 'completed']),
})

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '선택 항목 또는 변경할 진행상태가 올바르지 않습니다.' }, { status: 400 })
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const updated: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const id of body.data.ids) {
    try {
      const row = await updatePurchaseRequestStatus({
        userId: workspaceUserId,
        id,
        status: body.data.status,
      })
      if (row) updated.push(row.id)
      else failed.push({ id, error: '발주 항목을 찾을 수 없습니다.' })
    } catch (error) {
      failed.push({
        id,
        error: error instanceof Error ? error.message : '진행상태 변경에 실패했습니다.',
      })
    }
  }

  if (failed.length > 0) {
    return NextResponse.json(
      {
        updatedIds: updated,
        updatedCount: updated.length,
        failed,
        error: `${failed.length.toLocaleString('ko-KR')}건은 이동하지 못했습니다.`,
      },
      { status: updated.length > 0 ? 207 : 409 },
    )
  }

  return NextResponse.json({
    updatedIds: updated,
    updatedCount: updated.length,
    status: body.data.status,
    label: PURCHASE_REQUEST_STATUS_LABELS[body.data.status],
  })
}
