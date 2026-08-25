import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { deleteNewProductAttachment, getNewProductAttachment } from '@/lib/new-products/workflow'

export const runtime = 'nodejs'

type AttachmentRouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: AttachmentRouteContext) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const { id } = await context.params
  const attachment = await getNewProductAttachment({
    userId: workspaceUserId,
    requestedByUserId: user.id,
    attachmentId: id,
  })
  if (!attachment) return NextResponse.json({ error: '파일을 찾을 수 없습니다.' }, { status: 404 })

  return new NextResponse(Buffer.from(attachment.fileDataBase64, 'base64'), {
    headers: {
      'Content-Type': attachment.contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function DELETE(_request: Request, context: AttachmentRouteContext) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const { id } = await context.params
  const deleted = await deleteNewProductAttachment({
    userId: workspaceUserId,
    requestedByUserId: user.id,
    attachmentId: id,
  })
  if (!deleted) return NextResponse.json({ error: '삭제할 파일을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ success: true })
}
