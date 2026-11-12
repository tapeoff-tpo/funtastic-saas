import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  createPurchaseInspectionIssue,
  INSPECTION_ISSUE_IMAGE_TYPES,
  MAX_INSPECTION_ISSUE_ATTACHMENTS,
  MAX_INSPECTION_ISSUE_ATTACHMENT_BYTES,
} from '@/lib/purchasing/purchase-inspection-issues'

export const runtime = 'nodejs'

function isUploadedPhoto(entry: FormDataEntryValue): entry is File {
  return typeof entry === 'object'
    && entry !== null
    && typeof (entry as File).arrayBuffer === 'function'
    && typeof (entry as File).name === 'string'
    && typeof (entry as File).type === 'string'
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const id = z.string().uuid().safeParse((await params).id)
  if (!id.success) return NextResponse.json({ error: '발주 항목을 확인해주세요.' }, { status: 400 })

  try {
    const formData = await request.formData()
    const description = String(formData.get('description') ?? '').trim()
    if (!description) return NextResponse.json({ error: '오류 설명을 입력해주세요.' }, { status: 400 })
    if (description.length > 2_000) return NextResponse.json({ error: '오류 설명은 2,000자 이하로 입력해주세요.' }, { status: 400 })
    const files = formData.getAll('photos').filter(isUploadedPhoto)
    if (files.length > MAX_INSPECTION_ISSUE_ATTACHMENTS) {
      return NextResponse.json({ error: `사진은 최대 ${MAX_INSPECTION_ISSUE_ATTACHMENTS}장까지 첨부할 수 있습니다.` }, { status: 400 })
    }
    for (const file of files) {
      if (!INSPECTION_ISSUE_IMAGE_TYPES.has(file.type)) {
        return NextResponse.json({ error: '사진은 JPG, PNG, WEBP, GIF만 첨부할 수 있습니다.' }, { status: 400 })
      }
      if (file.size <= 0 || file.size > MAX_INSPECTION_ISSUE_ATTACHMENT_BYTES) {
        return NextResponse.json({ error: '사진은 압축 후 700KB 이하만 첨부할 수 있습니다.' }, { status: 400 })
      }
    }

    const saved = await createPurchaseInspectionIssue({
      userId: await getWorkspaceUserId(user.id),
      actorId: user.id,
      purchaseRequestItemId: id.data,
      description,
      attachments: await Promise.all(files.map(async (file) => ({
        fileName: file.name.slice(0, 500) || 'inspection-photo.jpg',
        contentType: file.type,
        fileBuffer: await file.arrayBuffer(),
      }))),
    })
    if (!saved) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
    for (const path of ['/purchasing/orders', '/purchasing/purchases', '/purchasing/overdue']) revalidatePath(path)
    return NextResponse.json(saved, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '검수 오류 등록에 실패했습니다.',
    }, { status: 409 })
  }
}
