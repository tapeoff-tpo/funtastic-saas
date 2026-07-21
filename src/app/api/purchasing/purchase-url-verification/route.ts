import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getPurchaseUrlVerificationQueue } from '@/lib/purchasing/purchase-url-collector'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const workspaceUserId = await authenticatedWorkspaceUserId()
  if (!workspaceUserId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 1_000, 1), 2_000)

  try {
    return NextResponse.json(await getPurchaseUrlVerificationQueue({
      userId: workspaceUserId,
      limit,
    }))
  } catch (error) {
    console.error('[purchase-url-verification-queue]', error)
    return NextResponse.json({ error: '구매 URL 검증 목록을 불러오지 못했습니다.' }, { status: 500 })
  }
}

async function authenticatedWorkspaceUserId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? getWorkspaceUserId(user.id) : null
}
