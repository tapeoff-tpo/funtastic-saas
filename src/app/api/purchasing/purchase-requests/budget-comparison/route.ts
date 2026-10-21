import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { exportPurchaseBudgetComparisonExcel } from '@/lib/purchasing/purchase-budget-comparison-excel'
import { getLatestPurchaseBudgetComparison } from '@/lib/purchasing/purchase-budget-comparison-store'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const comparison = await getLatestPurchaseBudgetComparison(await getWorkspaceUserId(user.id))
  if (!comparison) {
    return NextResponse.json({ error: '저장된 예산 비교가 없습니다. 구매예산을 입력하고 추천 계산을 먼저 실행해주세요.' }, { status: 404 })
  }

  const buffer = await exportPurchaseBudgetComparisonExcel(comparison)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(comparison.calculatedAt)).replaceAll('-', '')
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`발주_예산비교_${date}.xlsx`)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
