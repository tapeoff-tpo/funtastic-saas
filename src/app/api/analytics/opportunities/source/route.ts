import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { loadOpportunitySource } from '@/lib/opportunities/source'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  try {
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const asOf = parseOptionalDate(request.nextUrl.searchParams.get('asOf'))
    const includeCurrentMonth = request.nextUrl.searchParams.get('includeCurrentMonth') === '1'
    const source = await loadOpportunitySource({
      userId: workspaceUserId,
      asOfDate: asOf,
      includeCurrentMonth,
    })
    const body = {
      userId: source.userId,
      asOfDate: source.asOfDate.toISOString(),
      warnings: source.warnings,
      products: source.products,
    }
    const filename = `funtastic-opportunities-source-${dateKey(source.asOfDate)}.json`

    return new NextResponse(`${JSON.stringify(body, null, 2)}\n`, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (routeError) {
    return NextResponse.json(
      { error: routeError instanceof Error ? routeError.message : '기회 분석 데이터를 생성하지 못했습니다.' },
      { status: 500 },
    )
  }
}

function parseOptionalDate(value: string | null) {
  if (!value) return undefined
  const date = new Date(`${value}T12:00:00+09:00`)
  if (Number.isNaN(date.getTime())) throw new Error(`잘못된 asOf 날짜입니다: ${value}`)
  return date
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
}
