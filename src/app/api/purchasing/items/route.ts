import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createPurchasingItem, ESA009M_HEADERS } from '@/lib/purchasing/items'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  data: z.record(z.string(), z.string().nullable()).default({}),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '추가할 품목 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  const allowedHeaders = new Set<string>(ESA009M_HEADERS)
  const data = Object.fromEntries(
    Object.entries(body.data.data).filter(([header]) => allowedHeaders.has(header)),
  )

  const result = await createPurchasingItem({
    userId: await getWorkspaceUserId(user.id),
    data,
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ id: result.row?.id, updatedAt: result.row?.updatedAt }, { status: 201 })
}
