import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateSmsDevice,
  listSmsBridgeDevices,
  listSmsBridgeMessages,
  saveSmsBridgeMessage,
} from '@/lib/operations/sms-bridge'
import { getSmsBridgeWorkspaceUserId, readBearerToken } from '@/lib/operations/sms-bridge-auth'

const messageSchema = z.object({
  sender: z.string().trim().max(100).optional(),
  body: z.string().trim().min(1).max(2000),
  receivedAt: z.iso.datetime(),
  sourceMessageId: z.string().trim().max(200).optional(),
})

export async function GET() {
  const userId = await getSmsBridgeWorkspaceUserId()
  if (!userId) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const [devices, messages] = await Promise.all([
    listSmsBridgeDevices(userId),
    listSmsBridgeMessages(userId),
  ])
  return NextResponse.json({ devices, messages, serverNow: new Date().toISOString() })
}

export async function POST(request: Request) {
  const token = readBearerToken(request)
  if (!token) return NextResponse.json({ error: '기기 인증 토큰이 필요합니다.' }, { status: 401 })
  const device = await authenticateSmsDevice(token)
  if (!device) return NextResponse.json({ error: '연결이 해제된 기기입니다.' }, { status: 401 })

  try {
    const input = messageSchema.parse(await request.json())
    const receivedAt = new Date(input.receivedAt)
    if (Math.abs(Date.now() - receivedAt.getTime()) > 7 * 24 * 60 * 60_000) {
      return NextResponse.json({ error: '문자 수신 시각이 올바르지 않습니다.' }, { status: 400 })
    }
    const result = await saveSmsBridgeMessage({ device, ...input, receivedAt })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '문자를 저장하지 못했습니다.' },
      { status: 400 },
    )
  }
}
