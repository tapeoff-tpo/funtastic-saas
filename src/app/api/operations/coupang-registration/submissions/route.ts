import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { getSubmissions, recordSubmissionEvent, submissionEventSchema } from '@/lib/coupang-registration/submissions'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function GET(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  const id = request.nextUrl.searchParams.get('draftId')
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: '작업 ID를 확인해주세요.' }, { status: 400 })
  try { return NextResponse.json(await getSubmissions(workspace, id!), { headers: { 'Cache-Control': 'private, no-store' } }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '등록 상태를 확인하지 못했습니다.' }, { status: 400 }) }
}
export async function POST(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > 1_000_000) throw new Error('등록 결과가 너무 큽니다.')
    const event = submissionEventSchema.parse(JSON.parse(text))
    return NextResponse.json(await recordSubmissionEvent(workspace, event), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? '등록 결과 정보를 확인해주세요.' : error instanceof Error ? error.message : '등록 결과를 저장하지 못했습니다.' }, { status: 400 })
  }
}
