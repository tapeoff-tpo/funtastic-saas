import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getProfile, getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { QUALITY_ARCHIVE_LIMIT, readWorksQualityArchive, saveWorksQualityFiles } from '@/lib/new-products/works-quality-files'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const profile = await getProfile(user.id)
  if (profile?.role !== 'super_admin' || profile.deactivatedAt) return NextResponse.json({ error: '관리자만 가져올 수 있습니다.' }, { status: 403 })
  try {
    const body = await request.formData()
    const file = body.get('file')
    if (!(file instanceof File) || file.size > QUALITY_ARCHIVE_LIMIT) return NextResponse.json({ error: '4.3MB 이하의 품질표시 백업 ZIP을 선택해주세요.' }, { status: 400 })
    const files = await readWorksQualityArchive(Buffer.from(await file.arrayBuffer()))
    const results = await saveWorksQualityFiles({ userId: await getWorkspaceUserId(user.id), actorId: user.id, files })
    revalidatePath('/new-products')
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : '품질표시를 가져오지 못했습니다.' }, { status: 400 })
  }
}
