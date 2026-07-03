import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { updatePurchasingItemOutgoingMetrics } from '@/lib/purchasing/items'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  currentMonthOutgoing: z.coerce.number().min(0).default(0),
  threeMonthAverageOutgoing: z.coerce.number().min(0).default(0),
})

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/purchasing/items/[id]/outgoing'>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!body.success) {
    return NextResponse.json({ error: '출고수량은 0 이상의 숫자로 입력해주세요.' }, { status: 400 })
  }

  try {
    const { id } = await ctx.params
    const result = await updatePurchasingItemOutgoingMetrics({
      userId: await getWorkspaceUserId(user.id),
      productId: id,
      currentMonthOutgoing: body.data.currentMonthOutgoing,
      threeMonthAverageOutgoing: body.data.threeMonthAverageOutgoing,
    })
    revalidatePath('/costs')
    revalidatePath('/purchasing/orders')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[purchasing-items-outgoing-update]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '출고수량 저장에 실패했습니다.' },
      { status: 500 },
    )
  }
}
