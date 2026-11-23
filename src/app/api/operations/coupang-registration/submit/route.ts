import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { RegistrationConflict, submitRegistration } from '@/lib/coupang-registration/submissions'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: NextRequest) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  try {
    const input = z.object({ draftId: z.uuid(), revision: z.number().int().positive(), rowIds: z.array(z.string().min(1).max(100)).min(1).max(500) }).parse(await request.json())
    return NextResponse.json(await submitRegistration(workspace, input.draftId, input.revision, input.rowIds), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? '등록할 상품 정보를 확인해주세요.' : error instanceof Error ? error.message : '상품등록을 시작하지 못했습니다.' }, { status: error instanceof RegistrationConflict ? 409 : 400 })
  }
}
