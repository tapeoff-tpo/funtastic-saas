import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { applyPurchaseRequest1688TrackingLookup } from '@/lib/purchasing/purchase-requests'
import { createClient } from '@/lib/auth/server'
import { savePurchaseTrackingProductLinks } from '@/lib/purchasing/purchase-url-sync'

const lookupResultSchema = z.object({
  orderNumber: z.string().trim().regex(/^\d{10,40}$/),
  trackingNumbers: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  // Only the extension's exact `运单号码` extraction path may populate the
  // automatic purchase tracking flow. Older builds could include `物流编号`.
  trackingSource: z.literal('waybill_number'),
  trackingEvidence: z.object({
    label: z.literal('运单号码'),
    extractionVersion: z.literal(2),
  }).strict(),
  replaceUninspectedInspection: z.boolean().optional().default(false),
  productLinks: z.array(z.object({ url: z.string().trim().url().max(2_000), title: z.string().max(1_000).nullable().optional(),
    optionName: z.string().max(1_000).nullable().optional(), productCode: z.string().max(100).nullable().optional(),
    imageUrl: z.string().url().max(2_000).nullable().optional(),
  }).strict()).max(200).optional(),
}).strict()

/**
 * Accepts a result from the user's logged-in 1688 browser extension. The
 * server never receives 1688 credentials; it only applies a validated result
 * when the order number and purchase lifecycle still match.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const rawBody = await request.json().catch(() => null)
  const body = lookupResultSchema.safeParse(rawBody)
  if (!body.success) {
    const trackingSource = rawBody && typeof rawBody === 'object'
      ? (rawBody as { trackingSource?: unknown }).trackingSource
      : null
    const trackingEvidence = rawBody && typeof rawBody === 'object'
      ? (rawBody as { trackingEvidence?: unknown }).trackingEvidence
      : null
    const hasExactWaybillEvidence = trackingSource === 'waybill_number'
      && typeof trackingEvidence === 'object'
      && trackingEvidence !== null
      && (trackingEvidence as { label?: unknown }).label === '运单号码'
      && (trackingEvidence as { extractionVersion?: unknown }).extractionVersion === 2
    if (!hasExactWaybillEvidence) {
      return NextResponse.json({ error: '운송장번호 추출 확장프로그램을 1.10.1 이상으로 업데이트해주세요. 运单号码만 저장합니다.' }, { status: 400 })
    }
    return NextResponse.json({ error: '1688 송장 조회 결과가 올바르지 않습니다.' }, { status: 400 })
  }

  const { id } = await params
  const workspaceUserId = await getWorkspaceUserId(user.id)
  let row: Awaited<ReturnType<typeof applyPurchaseRequest1688TrackingLookup>>
  try {
    row = await applyPurchaseRequest1688TrackingLookup({
      userId: workspaceUserId,
      id,
      supplierOrderNumber: body.data.orderNumber,
      trackingNumbers: body.data.trackingNumbers,
      replaceUninspectedInspection: body.data.replaceUninspectedInspection,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '1688 송장번호를 저장하지 못했습니다.' },
      { status: 409 },
    )
  }

  if (!row) return NextResponse.json({ error: '발주 항목을 찾을 수 없습니다.' }, { status: 404 })
  let urlSyncWarning: string | undefined
  if (body.data.productLinks?.length) {
    try {
      await savePurchaseTrackingProductLinks({ userId: workspaceUserId, requestId: id,
        orderNumber: body.data.orderNumber, links: body.data.productLinks })
      revalidatePath('/costs')
      revalidatePath('/purchasing/items')
      revalidatePath('/new-products')
    } catch (error) {
      console.error('[tracking-product-url-sync]', error)
      urlSyncWarning = '송장은 저장했지만 구매 URL 연동에 실패했습니다. 발주 URL 연동을 다시 실행해주세요.'
    }
  }
  revalidatePath('/purchasing/overdue')
  revalidatePath('/purchasing/purchases')
  revalidatePath('/purchasing/orders')
  return NextResponse.json({ id: row.id, trackingCount: body.data.trackingNumbers.length, ...(urlSyncWarning ? { urlSyncWarning } : {}) })
}
