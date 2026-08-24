import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { reflectSelectedOutboundItems } from '@/lib/purchasing/reflected-outbound-items'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500).optional(),
  outboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((value) => Boolean(value.outboundDate || value.ids?.length), {
  message: '선택 항목 또는 출고날짜가 필요합니다.',
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '재고 반영이 끝난 출고완료 항목을 선택해주세요.' }, { status: 400 })
  }

  try {
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const result = await reflectSelectedOutboundItems({
      userId: workspaceUserId,
      reflectedByUserId: user.id,
      ids: body.data.ids,
      outboundDate: body.data.outboundDate,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '재고 반영 완료 처리에 실패했습니다.',
    }, { status: 409 })
  }
}
