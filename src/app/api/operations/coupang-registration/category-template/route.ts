import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { parseCategoryTemplate } from '@/lib/coupang-registration/category-template'

export const runtime = 'nodejs'
export const maxDuration = 60
const input = z.object({
  categoryId: z.string().regex(/^[1-9]\d{0,99}$/),
  file: z.object({ name: z.string().min(1).max(250), data: z.string().min(1).max(4_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/) }),
})

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' }
  if (!await registrationWorkspace()) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403, headers })
  try {
    const parsed = input.safeParse(await request.json())
    if (!parsed.success) throw new Error('카테고리 ID와 3MB 이하의 공식 견적서 파일을 확인해주세요.')
    return NextResponse.json({ template: await parseCategoryTemplate(parsed.data.categoryId, parsed.data.file) }, { headers })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '카테고리 견적서를 읽지 못했습니다.' }, { status: 400, headers })
  }
}
