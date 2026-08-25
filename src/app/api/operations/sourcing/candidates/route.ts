import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({
    error: '자동 1688 후보 수집은 현재 중지되어 있습니다. 소싱 탭에서 직접 등록해주세요.',
  }, { status: 410 })
}
