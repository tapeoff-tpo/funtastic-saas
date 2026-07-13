import { NextResponse } from 'next/server'
import { z } from 'zod'
import { claimSmsPairing } from '@/lib/operations/sms-bridge'

const schema = z.object({
  token: z.string().min(20).max(200),
  deviceName: z.string().trim().min(1).max(100),
  phoneLabel: z.string().trim().max(100).optional(),
  appVersion: z.string().trim().max(30).optional(),
})

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json())
    const result = await claimSmsPairing(input)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '기기를 연결하지 못했습니다.' },
      { status: 400 },
    )
  }
}
