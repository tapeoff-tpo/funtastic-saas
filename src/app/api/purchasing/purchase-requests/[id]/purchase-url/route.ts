import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { confirmPurchaseOrderProductUrl } from '@/lib/purchasing/purchase-url-sync'

const schema = z.object({
  orderNumber: z.string().trim().regex(/^\d{10,40}$/),
  url: z.string().trim().url().max(2_000), expectedUrl: z.string().trim().url().max(2_000).nullable(),
}).strict()

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const access = await getUserMenuAccess(user.id, user)
  if (!access || !['/purchasing/orders', '/purchasing/overdue'].some(menu => canUseMenu(access, menu))) {
    return NextResponse.json({ error: '발주 상품 링크를 수정할 권한이 없습니다.' }, { status: 403 })
  }
  const body = schema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '상품 링크 선택값을 확인해주세요.' }, { status: 400 })
  try {
    const result = await confirmPurchaseOrderProductUrl({ userId: await getWorkspaceUserId(user.id), requestId: (await params).id, ...body.data })
    for (const path of ['/purchasing/orders', '/purchasing/overdue', '/costs', '/new-products']) revalidatePath(path)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '상품 링크를 저장하지 못했습니다.' }, { status: 409 })
  }
}
