import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { saveSettlementConfirmation, saveSettlementRule } from '@/lib/analytics/settlement-calendar'
import { createClient } from '@/lib/supabase/server'

const confirmationSchema = z.object({
  type: z.literal('confirmation'), marketplaceId: z.string().min(1).max(50), date: z.string().date(),
  actualAmount: z.number().min(0), memo: z.string().max(1000).nullable().optional(),
})
const ruleSchema = z.object({
  type: z.literal('rule'), marketplaceId: z.string().min(1).max(50), payoutDelayDays: z.number().int().min(0).max(180),
  commissionRate: z.number().min(0).max(100).nullable(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const parsed = z.union([confirmationSchema, ruleSchema]).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: '정산 입력값을 확인해주세요.' }, { status: 400 })
  const userId = await getWorkspaceUserId(user.id)
  if (parsed.data.type === 'confirmation') await saveSettlementConfirmation(userId, parsed.data)
  else await saveSettlementRule(userId, parsed.data)
  return NextResponse.json({ ok: true })
}
