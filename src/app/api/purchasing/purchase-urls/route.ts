import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  applyPurchaseUrlCollectionResult,
  getPurchaseUrlCollectionQueue,
} from '@/lib/purchasing/purchase-url-collector'
import { createClient } from '@/lib/supabase/server'

const resultSchema = z.object({
  orderNumber: z.string().trim().regex(/^\d{10,40}$/),
  candidates: z.array(z.object({
    url: z.string().trim().max(2_000),
    title: z.string().trim().max(1_000).nullable().optional(),
  })).max(30),
})

export async function GET(request: NextRequest) {
  const workspaceUserId = await authenticatedWorkspaceUserId()
  if (!workspaceUserId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const prefix = request.nextUrl.searchParams.get('prefix')?.trim() || '3'
  if (!/^\d{1,4}$/.test(prefix)) {
    return NextResponse.json({ error: '주문번호 계정 규칙이 올바르지 않습니다.' }, { status: 400 })
  }
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 200, 1), 300)

  try {
    return NextResponse.json(await getPurchaseUrlCollectionQueue({
      userId: workspaceUserId,
      orderPrefix: prefix,
      limit,
    }))
  } catch (error) {
    console.error('[purchase-url-queue]', error)
    return NextResponse.json({ error: '구매 URL 수집 목록을 불러오지 못했습니다.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const workspaceUserId = await authenticatedWorkspaceUserId()
  if (!workspaceUserId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const body = resultSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '1688 URL 수집 결과가 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await applyPurchaseUrlCollectionResult({
      userId: workspaceUserId,
      ...body.data,
    }))
  } catch (error) {
    console.error('[purchase-url-result]', error)
    return NextResponse.json({ error: '구매 URL을 저장하지 못했습니다.' }, { status: 500 })
  }
}

async function authenticatedWorkspaceUserId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? getWorkspaceUserId(user.id) : null
}
