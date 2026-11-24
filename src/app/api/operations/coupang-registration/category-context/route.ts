import { NextRequest, NextResponse } from 'next/server'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { getCategoryContext } from '@/lib/coupang-registration/category-context'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' }
  if (!await registrationWorkspace()) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403, headers })
  const code = request.nextUrl.searchParams.get('code') ?? ''
  if (!/^\d{1,100}$/.test(code)) return NextResponse.json({ error: 'B2B 상품 코드를 확인해주세요.' }, { status: 400, headers })
  try {
    return NextResponse.json({ context: await getCategoryContext(code) }, { headers })
  } catch {
    return NextResponse.json({ error: 'B2B 상품 분류를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 502, headers })
  }
}
