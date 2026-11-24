import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  getPurchaseUrlVerificationQueue,
  markPurchaseUrlsForVerification,
  markPurchaseUrlsAsVerifiedOpen,
  PURCHASE_URL_VERIFICATION_BATCH_SIZE,
} from '@/lib/purchasing/purchase-url-collector'
import { createClient } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { syncPurchaseUrlsFromHistory } from '@/lib/purchasing/purchase-url-sync'
import { savePurchaseUrlVerificationHistory } from '@/lib/purchasing/purchase-url-verification-history'
import { canonicalize1688OfferUrl } from '@/lib/purchasing/purchase-url-values'

export const maxDuration = 60

const verificationResultSchema = z.object({
  url: z.string().trim().url().max(2_000),
  skus: z.array(z.string().trim().min(1).max(100)).min(1).max(200),
  reason: z.string().trim().max(1_000).nullable().optional(),
  // Older 1.14 SaaS pages only POST failures and omit status.
  status: z.enum(['open', 'unavailable', 'unknown']).default('unavailable'),
})

export async function GET(request: NextRequest) {
  const workspaceUserId = await authenticatedWorkspaceUserId()
  if (!workspaceUserId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const parsed = z.object({
    mode: z.enum(['due', 'issues', 'all']).default('due'),
    limit: z.coerce.number().int().min(1).max(100_000).default(PURCHASE_URL_VERIFICATION_BATCH_SIZE),
    cursor: z.string().max(2_000).optional(),
  }).safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success || (parsed.data.cursor && !canonicalize1688OfferUrl(parsed.data.cursor))) {
    return NextResponse.json({ error: 'URL 검증 목록의 조회 조건을 확인해주세요.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await getPurchaseUrlVerificationQueue({
      userId: workspaceUserId,
      ...parsed.data,
      limit: Math.min(parsed.data.limit, PURCHASE_URL_VERIFICATION_BATCH_SIZE),
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

  const rawBody = await request.json().catch(() => null)
  if (rawBody?.action === 'sync') {
    try {
      const result = await syncPurchaseUrlsFromHistory(workspaceUserId)
      refreshUrlPages()
      return NextResponse.json(result)
    } catch (error) {
      console.error('[purchase-url-sync]', error)
      return NextResponse.json({ error: '발주 구매 URL을 연동하지 못했습니다.' }, { status: 500 })
    }
  }
  const body = verificationResultSchema.safeParse(rawBody)
  if (!body.success) {
    return NextResponse.json({ error: 'URL 검증 결과가 올바르지 않습니다.' }, { status: 400 })
  }
  const url = canonicalize1688OfferUrl(body.data.url)
  if (!url) return NextResponse.json({ error: '1688 상품 URL을 확인해주세요.' }, { status: 400 })

  try {
    const result = body.data.status === 'open' ? await markPurchaseUrlsAsVerifiedOpen({ userId: workspaceUserId, ...body.data, url })
      : await markPurchaseUrlsForVerification({ userId: workspaceUserId, ...body.data, url })
    // Do not acknowledge a browser result until its URL history is durable.
    // Open URLs need this record too, so the next run can skip them for 30 days.
    await savePurchaseUrlVerificationHistory({ userId: workspaceUserId, url, status: body.data.status, reason: body.data.reason })
    if (result.updated.length || result.updatedWorkflow) refreshUrlPages()
    return NextResponse.json({ updated: result.updated.length, replaced: result.replaced, updatedWorkflow: result.updatedWorkflow })
  } catch (error) {
    console.error('[purchase-url-verification-result]', error)
    return NextResponse.json({ error: '확인 필요 URL을 반영하지 못했습니다.' }, { status: 500 })
  }
}

function refreshUrlPages() {
  for (const path of ['/costs', '/purchasing/items', '/new-products', '/purchasing/orders']) revalidatePath(path)
}

async function authenticatedWorkspaceUserId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? getWorkspaceUserId(user.id) : null
}
