import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { searchManualPurchaseCandidates } from '@/lib/purchasing/purchase-requests'
import { createClient } from '@/lib/supabase/server'

const querySchema = z.object({
  query: z.string().trim().min(1).max(200),
  targetStockMonths: z.coerce.number().min(0.1).max(12).default(1.2),
})

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get('query') ?? '',
    targetStockMonths: request.nextUrl.searchParams.get('targetStockMonths') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: '검색어와 목표 보유개월을 확인해주세요.' }, { status: 400 })
  }

  try {
    const items = await searchManualPurchaseCandidates({
      userId: await getWorkspaceUserId(user.id),
      query: parsed.data.query,
      targetStockMonths: parsed.data.targetStockMonths,
    })
    return NextResponse.json(
      { items },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[purchase-request-manual-candidates]', error)
    return NextResponse.json({ error: '품목 검색 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
