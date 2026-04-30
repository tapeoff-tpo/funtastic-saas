import { NextResponse } from 'next/server'

/**
 * 디버그용: 서버의 outbound IP 확인.
 * 마켓플레이스 API IP 화이트리스트에 등록할 IP를 알아내기 위한 임시 엔드포인트.
 * 인증 안 걸려있지만 IP만 노출하므로 보안상 문제 없음.
 */
export async function GET() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      cache: 'no-store',
    })
    const data = await res.json()
    return NextResponse.json({ outboundIp: data.ip, timestamp: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 }
    )
  }
}
