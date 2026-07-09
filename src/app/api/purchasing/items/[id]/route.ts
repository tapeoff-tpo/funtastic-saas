import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { ESA009M_HEADERS, updatePurchasingItem } from '@/lib/purchasing/items'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  data: z.record(z.string(), z.string().nullable()).default({}),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '수정할 품목 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  const allowedHeaders = new Set<string>(ESA009M_HEADERS)
  const data = Object.fromEntries(
    Object.entries(body.data.data).filter(([header]) => allowedHeaders.has(header)),
  )

  const { id } = await params
  const row = await updatePurchasingItem({
    userId: await getWorkspaceUserId(user.id),
    id,
    data,
  })

  if (!row) return NextResponse.json({ error: '수정할 품목을 찾을 수 없습니다.' }, { status: 404 })
  return NextResponse.json({ id: row.id, updatedAt: row.updatedAt })
}
