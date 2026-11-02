import { NextResponse } from 'next/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { syncNewProductCatalogueImages } from '@/lib/new-products/catalogue-images'

export const runtime = 'nodejs'
export const maxDuration = 60
const schema = z.object({ after: z.string().uuid().optional(), itemId: z.string().uuid().optional() })

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '상품 이미지 가져오기 요청을 확인해주세요.' }, { status: 400 })
  try {
    const result = await syncNewProductCatalogueImages({ ...parsed.data, userId: await getWorkspaceUserId(user.id), actorId: user.id })
    revalidatePath('/new-products')
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: '상품 이미지를 저장하지 못했습니다. 다시 시도해주세요.' }, { status: 500 })
  }
}
