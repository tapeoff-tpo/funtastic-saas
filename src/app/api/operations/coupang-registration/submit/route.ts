import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { RegistrationConflict, registrationSubmitSchema, submitRegistration } from '@/lib/coupang-registration/submissions'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > 4_000_000) throw new Error('등록 요청이 너무 큽니다. 상품을 나누어 등록해주세요.')
    const input = registrationSubmitSchema.parse(JSON.parse(text))
    const result = input.mode || input.categoryContexts
      ? await submitRegistration(workspace, input.draftId, input.revision, input.rowIds, input.mode ?? 'excel', input.categoryContexts ?? {})
      : await submitRegistration(workspace, input.draftId, input.revision, input.rowIds)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? '등록할 상품 정보를 확인해주세요.' : error instanceof Error ? error.message : '상품등록을 시작하지 못했습니다.' }, { status: error instanceof RegistrationConflict ? 409 : 400 })
  }
}
