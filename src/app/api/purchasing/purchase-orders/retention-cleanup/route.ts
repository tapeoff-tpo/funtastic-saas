import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { cleanupExpiredEcountPurchaseOrderRows } from '@/lib/purchasing/purchase-order-retention'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  try {
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const result = await cleanupExpiredEcountPurchaseOrderRows({ userId: workspaceUserId })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '오래된 주문서 정리에 실패했습니다.',
    }, { status: 500 })
  }
}
