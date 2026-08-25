import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getManualSourcingImage } from '@/lib/operations/sourcing'

export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const { id } = await context.params
  const image = await getManualSourcingImage({
    userId: await getWorkspaceUserId(user.id),
    actorUserId: user.id,
    itemId: id,
  })
  if (!image) return NextResponse.json({ error: '사진을 찾을 수 없습니다.' }, { status: 404 })

  return new NextResponse(Buffer.from(image.fileDataBase64, 'base64'), {
    headers: {
      'Content-Type': image.contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
