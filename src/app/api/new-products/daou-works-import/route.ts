import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { importDaouWorksProducts } from '@/lib/new-products/workflow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    const value = await request.json()
    body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return NextResponse.json({ error: '가져올 데이터를 읽지 못했습니다.' }, { status: 400 })
  }

  try {
    const result = await importDaouWorksProducts({
      userId: await getWorkspaceUserId(user.id),
      requestedByUserId: user.id,
      items: body.items,
      replaceStages: body.replaceStages === true,
    })
    revalidatePath('/new-products')
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'WORKS 가져오기 중 오류가 발생했습니다.' },
      { status: 400 },
    )
  }
}
