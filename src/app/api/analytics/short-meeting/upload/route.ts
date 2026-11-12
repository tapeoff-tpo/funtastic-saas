import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/auth/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import { parseShortMeetingWorkbook } from '@/lib/analytics/short-meeting-upload-parser'
import { isMeetingDate, saveShortMeetingUpload } from '@/lib/analytics/short-meeting-uploads'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  try { await assertMenuAccess('/analytics/short-meeting') } catch {
    return NextResponse.json({ error: '숏미팅 메뉴 접근 권한이 없습니다.' }, { status: 403 })
  }

  try {
    const form = await request.formData()
    const file = form.get('file')
    const action = form.get('action')
    const meetingDate = String(form.get('meetingDate') ?? '')
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.xlsx')) {
      return NextResponse.json({ error: '.xlsx 주문서 파일을 선택해 주세요.' }, { status: 400 })
    }
    if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: '파일은 4MB 이하여야 합니다.' }, { status: 400 })
    if (!isMeetingDate(meetingDate)) return NextResponse.json({ error: '올바른 기준일을 선택해 주세요.' }, { status: 400 })
    if (action !== 'preview' && action !== 'apply') return NextResponse.json({ error: '올바른 작업을 선택해 주세요.' }, { status: 400 })
    const buffer = Buffer.from(await file.arrayBuffer())
    let parsed
    try { parsed = await parseShortMeetingWorkbook(buffer) } catch (parseError) {
      return NextResponse.json({ error: parseError instanceof Error ? parseError.message : '주문서 파일을 읽지 못했습니다.' }, { status: 400 })
    }
    if (action === 'apply') {
      const userId = await getWorkspaceUserId(user.id)
      await saveShortMeetingUpload({ userId, actorId: user.id, meetingDate, fileName: file.name, buffer, rowCount: parsed.rowCount, items: parsed.items })
      revalidatePath('/analytics/short-meeting')
    }
    return NextResponse.json({ success: true, fileName: file.name, meetingDate, rowCount: parsed.rowCount,
      productCount: parsed.productCount, totalQuantity: parsed.totalQuantity, warnings: parsed.warnings, preview: parsed.items })
  } catch (caught) {
    console.error('short meeting upload error:', caught)
    return NextResponse.json({ error: '주문서를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
