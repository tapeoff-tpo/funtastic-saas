import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { applyPurchaseRequest1688TrackingLookup } from '@/lib/purchasing/purchase-requests'
import { createClient } from '@/lib/supabase/server'

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
  let row: Awaited<ReturnType<typeof applyPurchaseRequest1688TrackingLookup>>
  try {
    row = await applyPurchaseRequest1688TrackingLookup({
      userId: await getWorkspaceUserId(user.id),
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
  revalidatePath('/purchasing/overdue')
  revalidatePath('/purchasing/purchases')
  revalidatePath('/purchasing/orders')
  return NextResponse.json({ id: row.id, trackingCount: body.data.trackingNumbers.length })
}
