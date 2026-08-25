import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { addManualSourcingImage } from '@/lib/operations/sourcing'
import { getCurrentUser } from '@/lib/auth/current-user'

export const runtime = 'nodejs'

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const maxFileSize = 4 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    const formData = await request.formData()
    const file = formData.get('file')
    const itemId = String(formData.get('itemId') ?? '')

    if (!(file instanceof File) || !itemId) {
      return NextResponse.json({ error: '사진과 소싱 상품을 확인해주세요.' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > maxFileSize) {
      return NextResponse.json({ error: '사진은 4MB 이하만 등록할 수 있습니다.' }, { status: 400 })
    }
    if (!imageTypes.has(file.type)) {
      return NextResponse.json({ error: '사진은 JPG, PNG, WEBP, GIF만 등록할 수 있습니다.' }, { status: 400 })
    }

    await addManualSourcingImage({
      userId: await getWorkspaceUserId(user.id),
      requestedByUserId: user.id,
      itemId,
      fileName: file.name.slice(0, 500),
      contentType: file.type,
      fileBuffer: await file.arrayBuffer(),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '사진 등록에 실패했습니다.',
    }, { status: 500 })
  }
}
