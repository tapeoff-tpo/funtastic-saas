import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { updateSabangnetReviewLine, type SabangnetReviewLinePatch } from '@/lib/analytics/sabangnet-review'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ lineId: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { lineId } = await params
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const body = await request.json().catch(() => ({})) as Record<string, unknown>

  const patch: SabangnetReviewLinePatch = {
    orderNumber: stringValue(body.orderNumber),
    marketplaceName: stringValue(body.marketplaceName),
    marketplaceId: stringValue(body.marketplaceId),
    sku: stringValue(body.sku),
    productName: stringValue(body.productName),
    optionText: stringValue(body.optionText),
    quantity: numberValue(body.quantity),
    totalAmount: numberValue(body.totalAmount),
    shippingFee: body.shippingFee === null || body.shippingFee === ''
      ? null
      : numberValue(body.shippingFee),
  }

  try {
    const result = await updateSabangnetReviewLine(workspaceUserId, lineId, patch)
    revalidatePath('/analytics/sabangnet-review')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[SabangnetReviewLinePatch] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '보류 주문 수정 중 오류가 발생했습니다.' },
      { status: 500 },
    )
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}
