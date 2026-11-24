import { NextRequest, NextResponse } from 'next/server'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { listRegistrationTemplates, loadRegistrationTemplate } from '@/lib/coupang-registration/templates'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function GET(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  const id = request.nextUrl.searchParams.get('id')
  if (id !== null && !/^[a-f0-9]{64}$/.test(id)) return NextResponse.json({ error: '카테고리 양식 ID를 확인해주세요.' }, { status: 400 })
  try {
    const headers = { 'Cache-Control': 'private, no-store' }
    if (!id) return NextResponse.json({ templates: await listRegistrationTemplates(workspace) }, { headers })
    const template = await loadRegistrationTemplate(workspace, id)
    return template ? NextResponse.json({ template }, { headers }) : NextResponse.json({ error: '저장된 카테고리 양식을 찾을 수 없습니다.' }, { status: 404 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '카테고리 양식을 불러오지 못했습니다.' }, { status: 400 })
  }
}
