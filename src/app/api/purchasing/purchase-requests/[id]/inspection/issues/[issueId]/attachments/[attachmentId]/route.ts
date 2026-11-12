import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getPurchaseInspectionIssueAttachment } from '@/lib/purchasing/purchase-inspection-issues'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; issueId: string; attachmentId: string }> },
) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const ids = z.object({ id: z.string().uuid(), issueId: z.string().uuid(), attachmentId: z.string().uuid() })
    .safeParse(await params)
  if (!ids.success) return NextResponse.json({ error: '첨부 사진을 확인해주세요.' }, { status: 400 })
  const attachment = await getPurchaseInspectionIssueAttachment({
    userId: await getWorkspaceUserId(user.id),
    purchaseRequestItemId: ids.data.id,
    issueId: ids.data.issueId,
    attachmentId: ids.data.attachmentId,
  })
  if (!attachment) return NextResponse.json({ error: '첨부 사진을 찾을 수 없습니다.' }, { status: 404 })
  return new NextResponse(Buffer.from(attachment.fileDataBase64, 'base64'), {
    headers: {
      'Content-Type': attachment.contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'Cache-Control': 'private, max-age=300',
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
