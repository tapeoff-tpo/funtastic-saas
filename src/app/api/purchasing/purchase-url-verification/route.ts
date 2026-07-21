import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  getPurchaseUrlVerificationQueue,
  markPurchaseUrlsForVerification,
} from '@/lib/purchasing/purchase-url-collector'
import { createClient } from '@/lib/supabase/server'

const verificationResultSchema = z.object({
  url: z.string().trim().url().max(2_000),
  skus: z.array(z.string().trim().min(1).max(100)).min(1).max(200),
  reason: z.string().trim().max(1_000).nullable().optional(),
})

export async function GET(request: NextRequest) {
  const workspaceUserId = await authenticatedWorkspaceUserId()
  if (!workspaceUserId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit')) || 1_000, 1), 2_000)

  try {
    return NextResponse.json(await getPurchaseUrlVerificationQueue({
      userId: workspaceUserId,
      limit,
    }))
  } catch (error) {
    console.error('[purchase-url-verification-queue]', error)
    return NextResponse.json({ error: '구매 URL 검증 목록을 불러오지 못했습니다.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const workspaceUserId = await authenticatedWorkspaceUserId()
  if (!workspaceUserId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const body = verificationResultSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'URL 검증 결과가 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const result = await markPurchaseUrlsForVerification({
      userId: workspaceUserId,
      ...body.data,
    })
    return NextResponse.json({ updated: result.updated.length })
  } catch (error) {
    console.error('[purchase-url-verification-result]', error)
    return NextResponse.json({ error: '확인 필요 URL을 반영하지 못했습니다.' }, { status: 500 })
  }
}

async function authenticatedWorkspaceUserId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? getWorkspaceUserId(user.id) : null
}
