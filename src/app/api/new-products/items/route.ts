import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { listNewProductSummaries } from '@/lib/new-products/workflow'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const url = new URL(request.url)
  const stageId = url.searchParams.get('stageId')
  if (stageId && !isUuid(stageId)) {
    return NextResponse.json({ error: '진행 단계를 확인해주세요.' }, { status: 400 })
  }
  const ownerOperatorId = url.searchParams.get('ownerOperatorId')
  if (ownerOperatorId && !isUuid(ownerOperatorId)) {
    return NextResponse.json({ error: '등록자 정보를 확인해주세요.' }, { status: 400 })
  }
  const result = await listNewProductSummaries({
    userId: workspaceUserId,
    actorUserId: user.id,
    stageId,
    query: url.searchParams.get('query'),
    ownerOperatorId,
    limit: 50,
  })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
