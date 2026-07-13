import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateSmsDevice, touchSmsDevice } from '@/lib/operations/sms-bridge'
import { readBearerToken } from '@/lib/operations/sms-bridge-auth'

const schema = z.object({ appVersion: z.string().trim().max(30).optional() })

export async function POST(request: Request) {
  const token = readBearerToken(request)
  if (!token) return NextResponse.json({ error: '기기 인증 토큰이 필요합니다.' }, { status: 401 })
  const device = await authenticateSmsDevice(token)
  if (!device) return NextResponse.json({ error: '연결이 해제된 기기입니다.' }, { status: 401 })
  const body = schema.parse(await request.json().catch(() => ({})))
  await touchSmsDevice(device.id, body.appVersion)
  return NextResponse.json({ ok: true })
}
