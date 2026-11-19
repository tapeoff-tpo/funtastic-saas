import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { renderQualityPdfLabels } from '@/lib/coupang-registration/quality-label-renderer'
import { getNewProductAttachment } from '@/lib/new-products/workflow'

export const runtime = 'nodejs'
export const maxDuration = 60

const inputSchema = z.object({ attachmentId: z.uuid() })

export async function POST(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })

  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '품질표시 PDF를 확인해주세요.' }, { status: 400 })

  try {
    const attachment = await getNewProductAttachment({
      userId: workspace,
      requestedByUserId: (await getCurrentUser())?.id ?? workspace,
      attachmentId: parsed.data.attachmentId,
    })
    if (!attachment) return NextResponse.json({ error: '상품관리 품질표시 PDF를 찾을 수 없습니다.' }, { status: 404 })
    if (attachment.contentType !== 'application/pdf') return NextResponse.json({ error: '상품관리의 PDF 품질표시만 자동 변환할 수 있습니다.' }, { status: 400 })

    const labels = await renderQualityPdfLabels({
      attachmentId: parsed.data.attachmentId,
      fileName: attachment.fileName,
      bytes: Buffer.from(attachment.fileDataBase64 ?? '', 'base64'),
    })
    return NextResponse.json({ labels })
  } catch (error) {
    console.error('Coupang quality-label conversion failed', error instanceof Error ? error.name : 'Unknown error')
    return NextResponse.json({
      error: error instanceof Error ? error.message : '품질표시 PDF를 JPG로 변환하지 못했습니다.',
    }, { status: 400 })
  }
}
