import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { getPurchase1688TrackingCandidates } from '@/lib/purchasing/purchase-tracking-candidates'

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const access = await getUserMenuAccess(user.id)
  if (!access || !['/purchasing/orders', '/purchasing/overdue'].some((menu) => canUseMenu(access, menu))) {
    return NextResponse.json({ error: '송장 조회 권한이 없습니다.' }, { status: 403 })
  }
  const mode = new URL(request.url).searchParams.get('mode') ?? 'initial'
  if (mode !== 'initial' && mode !== 'recollect') return NextResponse.json({ error: '송장 조회 대상을 확인해주세요.' }, { status: 400 })
  const candidates = await getPurchase1688TrackingCandidates(await getWorkspaceUserId(user.id), mode)
  return NextResponse.json({ candidates }, { headers: { 'Cache-Control': 'private, no-store' } })
}
