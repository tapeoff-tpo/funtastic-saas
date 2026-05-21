'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { runAutoCombineByContact } from '@/lib/shipping/auto-combine'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

/**
 * 확정대기 단계에서 마켓 + 수취인 + 우편번호 + 주소가 동일한 주문을
 * 일괄 합포장 그룹으로 만든다.
 *
 * - 취소/반품/교환/미발송, 주소정보 누락, 택배사/송장번호 충돌 건은 제외
 * - fulfillmentCode별로 추가 분리 (혼합배송 방지)
 * - maxPackQuantity(기본 10)로 chunking
 * - 선택된 orderIds 내에서만 (없으면 user의 미출고 전체)
 */
export async function bulkCombineByContactAction(
  orderIds?: string[],
): Promise<{ created: number; totalOrders: number }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { created: 0, totalOrders: 0 }
  const userId = await getWorkspaceUserId(user.id)

  const conditions = [eq(orders.userId, userId)]
  if (orderIds && orderIds.length > 0) {
    conditions.push(inArray(orders.id, orderIds))
  } else {
    // 기본: 확정대기 단계 (status='new', 매핑완료는 items에서 개별 판단 불가 → status만)
    conditions.push(eq(orders.status, 'new'))
  }

  const orderRows = await db
    .select({
      id: orders.id,
    })
    .from(orders)
    .where(and(...conditions))

  if (orderRows.length === 0) return { created: 0, totalOrders: 0 }
  const result = await runAutoCombineByContact(userId, orderRows.map((row) => row.id))

  revalidatePath('/orders')
  revalidateTag('orders', 'max')
  revalidatePath('/shipping/combined')
  return result
}
