import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { addChinaPurchaseFundTransaction, getChinaPurchaseFundSummary } from '@/lib/purchasing/china-purchase-funds'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  transactionDate: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
  type: z.enum(['transfer_in', 'purchase_out', 'adjustment_in', 'adjustment_out']),
  amountCny: z.coerce.number().positive().max(100_000_000),
  amountKrw: z.coerce.number().positive().max(100_000_000_000).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
})

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  return NextResponse.json(await getChinaPurchaseFundSummary(await getWorkspaceUserId(user.id)))
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: '이체 내역이 올바르지 않습니다.' }, { status: 400 })
  await addChinaPurchaseFundTransaction({
    userId: await getWorkspaceUserId(user.id),
    createdByUserId: user.id,
    ...body.data,
  })
  return NextResponse.json({ ok: true })
}
