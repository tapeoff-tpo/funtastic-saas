import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getNewProductItem } from '@/lib/new-products/workflow'

export const dynamic = 'force-dynamic'

type ItemRouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: ItemRouteContext) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const { id } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: '상품 번호를 확인해주세요.' }, { status: 400 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const item = await getNewProductItem({ userId: workspaceUserId, itemId: id })
  if (!item) return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ item }, { headers: { 'Cache-Control': 'private, no-store' } })
}
