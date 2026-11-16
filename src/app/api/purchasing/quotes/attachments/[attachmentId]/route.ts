import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { createClient } from '@/lib/auth/server'
import { deleteQuoteSaleAttachment, getQuoteSaleAttachment } from '@/lib/quotes/store'

export const runtime = 'nodejs'

async function workspace() {
  await assertMenuAccess('/purchasing/quotes')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { actorUserId: user.id, userId: await getWorkspaceUserId(user.id) }
}

async function attachmentRequest(request: NextRequest, params: Promise<{ attachmentId: string }>) {
  const current = await workspace()
  if (!current) return { error: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) }
  const parsed = z.object({ attachmentId: z.string().uuid() }).safeParse(await params)
  const saleId = request.nextUrl.searchParams.get('saleId')?.trim()
  if (!parsed.success || !saleId) {
    return { error: NextResponse.json({ error: '첨부파일을 확인해주세요.' }, { status: 400 }) }
  }
  return { current, attachmentId: parsed.data.attachmentId, saleId }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const input = await attachmentRequest(request, params)
    if ('error' in input) return input.error
    const attachment = await getQuoteSaleAttachment({
      userId: input.current.userId,
      saleClientId: input.saleId,
      attachmentId: input.attachmentId,
    })
    if (!attachment) return NextResponse.json({ error: '첨부파일을 찾을 수 없습니다.' }, { status: 404 })
    return new NextResponse(new Uint8Array(attachment.fileData), {
      headers: {
        'Content-Type': attachment.contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
        'Content-Length': String(attachment.fileSize),
        'Cache-Control': 'private, max-age=300',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[quote-attachments:download]', error)
    return NextResponse.json({ error: '첨부파일을 불러오지 못했습니다.' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const input = await attachmentRequest(request, params)
    if ('error' in input) return input.error
    const deleted = await deleteQuoteSaleAttachment({
      userId: input.current.userId,
      saleClientId: input.saleId,
      attachmentId: input.attachmentId,
    })
    if (!deleted) return NextResponse.json({ error: '첨부파일을 찾을 수 없습니다.' }, { status: 404 })
    revalidatePath('/purchasing/quotes')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[quote-attachments:delete]', error)
    return NextResponse.json({ error: '첨부파일을 삭제하지 못했습니다.' }, { status: 500 })
  }
}
