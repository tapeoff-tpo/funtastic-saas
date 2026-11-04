import { NextRequest, NextResponse } from 'next/server'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { draftSchema } from '@/lib/coupang-registration/schema'
import { buildRegistrationArchive } from '@/lib/coupang-registration/excel'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: NextRequest) {
  if (!await registrationWorkspace()) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > 4_000_000) throw new Error('작업 용량이 4MB를 초과했습니다. 상품을 나눠 다운로드해주세요.')
    const parsed = draftSchema.safeParse(JSON.parse(text))
    if (!parsed.success) throw new Error('상품·파일 입력값을 확인해주세요.')
    const archive = await buildRegistrationArchive(parsed.data)
    return new NextResponse(new Uint8Array(archive), { headers: {
      'Content-Type': 'application/zip', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`쿠팡상품등록_${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })}.zip`)}`,
    } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '견적서를 만들지 못했습니다.' }, { status: 400 })
  }
}
