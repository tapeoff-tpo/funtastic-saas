import { NextResponse } from 'next/server'
import { z } from 'zod'
import { registrationWorkspace } from '@/lib/coupang-registration/auth'
import { lookupRegistrationCosts } from '@/lib/coupang-registration/catalog'

const lookupSchema = z.array(z.object({
  id: z.string().min(1).max(100),
  internalSku: z.string().max(100),
  name: z.string().max(500),
  sourceName: z.string().max(500),
  optionName: z.string().max(300),
})).min(1).max(30)

export async function POST(request: Request) {
  const workspace = await registrationWorkspace()
  if (!workspace) return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403 })
  const parsed = lookupSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '원가를 조회할 상품 목록을 확인해주세요.' }, { status: 400 })
  try {
    return NextResponse.json({ costs: await lookupRegistrationCosts(workspace, parsed.data) })
  } catch (error) {
    console.error('Coupang registration cost lookup failed', error)
    return NextResponse.json({ error: '품목 원가를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.' }, { status: 502 })
  }
}
