import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createFigmaBridgePairing } from '@/lib/operations/detail-page-drafts'
import { getDetailPageWorkspaceUser } from '@/lib/operations/detail-page-bridge-auth'

const schema = z.object({ deviceLabel: z.string().trim().max(100).optional() })

export async function POST(request: Request) {
  const identity = await getDetailPageWorkspaceUser()
  if (!identity) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = schema.safeParse(await request.json().catch(() => ({})))
  if (!body.success) return NextResponse.json({ error: 'Figma 연결 이름이 올바르지 않습니다.' }, { status: 400 })

  const pairing = await createFigmaBridgePairing(identity.workspaceUserId, body.data.deviceLabel)
  return NextResponse.json({
    pairingToken: pairing.pairingToken,
    expiresAt: pairing.expiresAt.toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
