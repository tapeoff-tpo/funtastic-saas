import { NextResponse } from 'next/server'
import { z } from 'zod'
import { claimFigmaBridgePairing } from '@/lib/operations/detail-page-drafts'
import { bridgeHeaders } from '@/lib/operations/detail-page-bridge-auth'

const schema = z.object({
  pairingToken: z.string().min(20).max(200),
  deviceName: z.string().trim().min(1).max(100),
  figmaFileKey: z.string().trim().min(10).max(120),
  pluginVersion: z.string().trim().max(30).optional(),
})

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: bridgeHeaders() })
}

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json())
    const result = await claimFigmaBridgePairing(body)
    return NextResponse.json(result, { headers: bridgeHeaders() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Figma 플러그인을 연결하지 못했습니다.' },
      { status: 400, headers: bridgeHeaders() },
    )
  }
}
