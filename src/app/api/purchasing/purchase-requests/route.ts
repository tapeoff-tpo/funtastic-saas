import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createPurchaseRequest } from '@/lib/purchasing/purchase-request-create'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  sku: z.string().trim().min(1).max(100),
  productName: z.string().trim().min(1).max(500),
  optionName: z.string().trim().max(200).nullable().optional(),
  requestedQuantity: z.number().int().min(1).max(1_000_000),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json(
      { error: '상품코드, 상품명, 옵션, 수량을 확인해주세요.' },
      { status: 400 },
    )
  }

  try {
    const row = await createPurchaseRequest({
      userId: await getWorkspaceUserId(user.id),
      ...body.data,
    })

    revalidatePath('/purchasing/purchases')
    return NextResponse.json({ id: row.id }, { status: 201 })
  } catch (error) {
    console.error('[purchase-request-create]', error)
    return NextResponse.json({ error: '발주 항목을 추가하지 못했습니다.' }, { status: 500 })
  }
}
