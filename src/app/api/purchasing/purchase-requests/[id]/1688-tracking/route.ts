import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { applyPurchaseRequest1688TrackingLookup } from '@/lib/purchasing/purchase-requests'
import { createClient } from '@/lib/supabase/server'

const lookupResultSchema = z.object({
  orderNumber: z.string().trim().regex(/^\d{10,40}$/),
  trackingNumbers: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
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

  const body = lookupResultSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
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
