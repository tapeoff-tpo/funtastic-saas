import { NextRequest, NextResponse } from 'next/server'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { readTemplate } from '@/lib/coupang-registration/excel'

export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: NextRequest) {
  if (!await registrationWorkspace()) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.xlsx') || file.size > 3_000_000) throw new Error('3MB 이하의 쿠팡 견적서 .xlsx 파일을 선택해주세요.')
    return NextResponse.json(await readTemplate(Buffer.from(await file.arrayBuffer()), file.name))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '견적서를 읽지 못했습니다.' }, { status: 400 })
  }
}
