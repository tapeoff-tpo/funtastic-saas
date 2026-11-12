'use server'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { assertMenuAccess } from '@/lib/auth/menu-access'
import {
  applyProductLink,
  previewProductLink,
} from '@/lib/product-linking/store'
import type { LinkTarget } from '@/lib/product-linking/plan'
const menus: Record<LinkTarget, string[]> = {
  item: ['/new-products', '/costs'],
  cost: ['/costs', '/analytics/price-table'],
  price: ['/analytics/price-table', '/new-products'],
  registration: ['/new-products', '/operations/marketplace-registration'],
}
async function context(itemId: string, target: LinkTarget) {
  if (!/^[0-9a-f-]{36}$/i.test(itemId) || !Object.hasOwn(menus, target))
    throw new Error('연결할 상품과 대상을 확인해주세요.')
  for (const menu of menus[target]) await assertMenuAccess(menu)
  const user = await getCurrentUser()
  if (!user) throw new Error('로그인이 필요합니다.')
  return { actorId: user.id, userId: await getWorkspaceUserId(user.id) }
}
export async function previewProductLinkAction(
  itemId: string,
  target: LinkTarget,
) {
  try {
    const auth = await context(itemId, target)
    return {
      success: true as const,
      preview: await previewProductLink(auth.userId, itemId, target),
    }
  } catch (e) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : '연결 비교에 실패했습니다.',
    }
  }
}
export async function applyProductLinkAction(
  itemId: string,
  target: LinkTarget,
  token: string,
) {
  try {
    const auth = await context(itemId, target)
    const result = await applyProductLink(
      auth.userId,
      auth.actorId,
      itemId,
      target,
      token,
    )
    for (const path of [
      '/new-products',
      '/costs',
      '/analytics/price-table',
      '/operations/marketplace-registration',
    ])
      revalidatePath(path)
    return { success: true as const, ...result }
  } catch (e) {
    return {
      success: false as const,
      error: e instanceof Error ? e.message : '동기화에 실패했습니다.',
    }
  }
}

export async function requestWorkflowPurchaseAction(
  itemId: string,
  quantity: number,
  sampleDecision: 'approved' | 'skipped',
) {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(itemId))
      throw new Error('상품을 확인해주세요.')
    await assertMenuAccess('/new-products')
    await assertMenuAccess('/purchasing/orders')
    const user = await getCurrentUser()
    if (!user) throw new Error('로그인이 필요합니다.')
    const { requestWorkflowPurchase } = await import(
      '@/lib/product-linking/purchase'
    )
    const result = await requestWorkflowPurchase({
      userId: await getWorkspaceUserId(user.id),
      actorId: user.id,
      itemId,
      quantity,
      sampleDecision,
    })
    revalidatePath('/new-products')
    revalidatePath('/purchasing/orders')
    return { success: true as const, ...result }
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : '발주 요청에 실패했습니다.',
    }
  }
}

export async function uploadWorkflowDetailPageAction(
  itemId: string,
  form: FormData,
) {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(itemId))
      throw new Error('상품을 확인해주세요.')
    await assertMenuAccess('/new-products')
    await assertMenuAccess('/operations/detail-pages')
    const user = await getCurrentUser()
    if (!user) throw new Error('로그인이 필요합니다.')
    const file = form.get('image')
    if (!(file instanceof File) || !file.size || file.size > 4 * 1024 * 1024) {
      throw new Error('4MB 이하의 완성 상세페이지 이미지를 선택해주세요.')
    }
    const { uploadWorkflowDetailPage } = await import(
      '@/lib/product-linking/detail-page'
    )
    const url = await uploadWorkflowDetailPage(
      await getWorkspaceUserId(user.id),
      itemId,
      file,
    )
    revalidatePath('/new-products')
    revalidatePath('/operations/detail-pages')
    return { success: true as const, url }
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof Error
          ? error.message
          : '상세페이지 등록에 실패했습니다.',
    }
  }
}
