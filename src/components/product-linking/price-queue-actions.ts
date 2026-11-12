'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import {
  listPriceQueue,
  saveQueuePrices,
} from '@/lib/product-linking/price-queue'
async function context() {
  await assertMenuAccess('/analytics/price-table')
  const user = await getCurrentUser()
  if (!user) throw Error('로그인이 필요합니다.')
  return { actorId: user.id, userId: await getWorkspaceUserId(user.id) }
}
export async function loadPriceQueueAction(
  filter: 'missing' | 'excluded' | 'all',
  search: string,
) {
  try {
    if (!['missing', 'excluded', 'all'].includes(filter))
      throw Error('필터를 확인해주세요.')
    const c = await context()
    return {
      success: true as const,
      rows: await listPriceQueue(c.userId, filter, search),
    }
  } catch (e) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : '조회에 실패했습니다.',
    }
  }
}
export async function saveQueuePricesAction(input: {
  id: string
  b2b: string
  b2c: string
  excluded: boolean
  reason: string
}) {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(input.id)) throw Error('상품을 확인해주세요.')
    const c = await context()
    await saveQueuePrices(c.userId, c.actorId, input)
    revalidatePath('/analytics/price-table')
    return { success: true as const }
  } catch (e) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : '저장에 실패했습니다.',
    }
  }
}
