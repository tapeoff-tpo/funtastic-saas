import { NextResponse } from 'next/server'
import {
  authenticateFigmaBridgeDevice,
  claimNextDetailPageDraft,
  touchFigmaBridgeDevice,
} from '@/lib/operations/detail-page-drafts'
import { bridgeHeaders, readBearerToken } from '@/lib/operations/detail-page-bridge-auth'

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: bridgeHeaders() })
}

export async function POST(request: Request) {
  const token = readBearerToken(request)
  if (!token) return NextResponse.json({ error: 'Figma 플러그인 연결 토큰이 필요합니다.' }, { status: 401, headers: bridgeHeaders() })

  const device = await authenticateFigmaBridgeDevice(token)
  if (!device) return NextResponse.json({ error: '연결이 해제되었거나 만료된 Figma 플러그인입니다.' }, { status: 401, headers: bridgeHeaders() })

  await touchFigmaBridgeDevice(device.id, request.headers.get('x-funtastic-plugin-version'))
  const job = await claimNextDetailPageDraft(device)
  return NextResponse.json({ job }, { headers: bridgeHeaders() })
}
