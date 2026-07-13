import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { z } from 'zod'
import { createSmsPairing } from '@/lib/operations/sms-bridge'
import { getSmsBridgeWorkspaceUserId } from '@/lib/operations/sms-bridge-auth'

const schema = z.object({
  accountId: z.uuid(),
  deviceLabel: z.string().trim().max(100).optional(),
})

export async function POST(request: Request) {
  const userId = await getSmsBridgeWorkspaceUserId()
  if (!userId) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const input = schema.parse(await request.json())
    const pairing = await createSmsPairing({ userId, ...input })
    const origin = new URL(request.url).origin
    const pairingUri = `funtastic-sms://pair?server=${encodeURIComponent(origin)}&token=${encodeURIComponent(pairing.token)}`
    const qrDataUrl = await QRCode.toDataURL(pairingUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
      color: { dark: '#111827', light: '#ffffff' },
    })
    return NextResponse.json({
      pairingUri,
      qrDataUrl,
      expiresAt: pairing.expiresAt.toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '연결 QR을 만들지 못했습니다.' },
      { status: 400 },
    )
  }
}
