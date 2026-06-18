import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { confirmSabangnetReviewBatch } from '@/lib/analytics/sabangnet-review'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { batchId } = await params
  const workspaceUserId = await getWorkspaceUserId(user.id)

  try {
    const result = await confirmSabangnetReviewBatch(workspaceUserId, batchId)
    revalidatePath('/analytics')
    revalidatePath('/analytics/sabangnet-review')
    revalidatePath('/orders')
    revalidateTag('orders', 'max')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[SabangnetReviewConfirm] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '사방넷 주문 확정 반영 중 오류가 발생했습니다.' },
      { status: 500 },
    )
  }
}
