import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { updatePurchaseRequestPlanFields } from '@/lib/purchasing/purchase-requests'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  buyerCode: z.enum(['1', '2', '3', '4', '5']).nullable().optional(),
}).refine(
  (body) => body.buyerCode !== undefined,
  { message: '변경할 값이 없습니다.' },
)

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '전체 적용할 값이 올바르지 않습니다.' }, { status: 400 })
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const updated: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const id of body.data.ids) {
    try {
      const row = await updatePurchaseRequestPlanFields({
        userId: workspaceUserId,
        id,
        buyerCode: body.data.buyerCode,
      })
      if (row) updated.push(row.id)
      else failed.push({ id, error: '발주 항목을 찾을 수 없습니다.' })
    } catch (error) {
      failed.push({
        id,
        error: error instanceof Error ? error.message : '전체 적용에 실패했습니다.',
      })
    }
  }

  if (failed.length > 0) {
    return NextResponse.json(
      {
        updatedIds: updated,
        updatedCount: updated.length,
        failed,
        error: `${failed.length.toLocaleString('ko-KR')}건은 적용하지 못했습니다.`,
      },
      { status: updated.length > 0 ? 207 : 409 },
    )
  }

  return NextResponse.json({
    updatedIds: updated,
    updatedCount: updated.length,
  })
}
