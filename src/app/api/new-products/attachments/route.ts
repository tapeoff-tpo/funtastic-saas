import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { addNewProductAttachment, type NewProductAttachment } from '@/lib/new-products/workflow'

export const runtime = 'nodejs'

const attachmentKinds = new Set<NewProductAttachment['kind']>([
  'product_image',
  'sample_china_image',
  'final_sample_image',
  'quality_pdf',
])
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const maxFileSize = 4 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const formData = await request.formData()
    const file = formData.get('file')
    const itemId = String(formData.get('itemId') ?? '')
    const kind = String(formData.get('kind') ?? '') as NewProductAttachment['kind']

    if (!(file instanceof File) || !itemId || !attachmentKinds.has(kind)) {
      return NextResponse.json({ error: '첨부 대상과 파일 종류를 확인해주세요.' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > maxFileSize) {
      return NextResponse.json({ error: '파일은 4MB 이하만 업로드할 수 있습니다.' }, { status: 400 })
    }
    if (kind === 'quality_pdf' ? file.type !== 'application/pdf' : !imageTypes.has(file.type)) {
      return NextResponse.json({
        error: kind === 'quality_pdf' ? '품질표시 파일은 PDF만 가능합니다.' : '이미지는 JPG, PNG, WEBP, GIF만 가능합니다.',
      }, { status: 400 })
    }

    const result = await addNewProductAttachment({
      userId: workspaceUserId,
      requestedByUserId: user.id,
      itemId,
      kind,
      fileName: file.name.slice(0, 500),
      contentType: file.type,
      fileBuffer: await file.arrayBuffer(),
    })
    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '파일 업로드에 실패했습니다.',
    }, { status: 500 })
  }
}
