import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  createPurchaseFundCredit,
  PURCHASE_FUND_MANUAL_ENTRY_TYPES,
} from '@/lib/purchasing/purchase-fund-ledger'
import { createClient } from '@/lib/supabase/server'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate)

const bodySchema = z.object({
  entryType: z.enum(PURCHASE_FUND_MANUAL_ENTRY_TYPES),
  occurredOn: dateSchema,
  amountKrw: z.number().positive().max(100_000_000_000),
  amountCny: z.number().positive().max(1_000_000_000).nullable().optional(),
  memo: z.string().trim().max(500).nullable().optional(),
}).strict()

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: '입금 내역을 올바르게 입력해주세요.' }, { status: 400 })
  }

  try {
    const row = await createPurchaseFundCredit({
      userId: await getWorkspaceUserId(user.id),
      createdBy: user.id,
      ...body.data,
    })
    revalidatePath('/purchasing/payment-flow')
    return NextResponse.json({ id: row?.id })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '입금 내역을 저장하지 못했습니다.',
    }, { status: 500 })
  }
}

function isCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}
