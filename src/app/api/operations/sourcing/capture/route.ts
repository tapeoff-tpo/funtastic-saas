import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createSourcingItem } from '@/lib/operations/sourcing'
import { createClient } from '@/lib/supabase/server'

const captureSchema = z.object({
  sourceTitle: z.string().trim().min(1).max(1_000),
  sourceUrl: z.string().trim().max(2_000).nullable().optional(),
  imageUrl: z.string().trim().max(2_000).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  sourceRank: z.number().int().nonnegative().nullable().optional(),
  sourcePrice: z.number().int().nonnegative().nullable().optional(),
  keyword: z.string().trim().max(200).nullable().optional(),
  memo: z.string().trim().max(2_000).nullable().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = captureSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '소싱 상품 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  const result = await createSourcingItem({
    userId: await getWorkspaceUserId(user.id),
    ...body.data,
  })

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result, { status: 'updated' in result ? 200 : 201 })
}
