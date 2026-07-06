import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { generatePurchaseRecommendations } from '@/lib/purchasing/purchase-recommendations'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  targetStockMonths: z.coerce.number().min(0.1).max(12).default(1.2),
  budgetKrw: z.coerce.number().positive().max(10_000_000_000).nullable().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!body.success) {
    return NextResponse.json({ error: '목표 보유개월수는 0.1~12 사이로 입력해주세요.' }, { status: 400 })
  }

  try {
    const result = await generatePurchaseRecommendations({
      userId: await getWorkspaceUserId(user.id),
      requestedByUserId: user.id,
      targetStockMonths: body.data.targetStockMonths,
      budgetKrw: body.data.budgetKrw,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[purchase-recommendations]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '자동 발주 추천 생성에 실패했습니다.' },
      { status: 500 },
    )
  }
}
