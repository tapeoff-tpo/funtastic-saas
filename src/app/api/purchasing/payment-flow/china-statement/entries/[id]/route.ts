import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  updateChinaFundStatementEntry,
  voidChinaFundStatementEntry,
} from '@/lib/purchasing/china-fund-statement'
import { createClient } from '@/lib/supabase/server'

const entryIdSchema = z.string().uuid()
const updateSchema = z.object({
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  signedAmountCny: z.number().finite().min(-1_000_000_000).max(1_000_000_000)
    .refine((value) => value !== 0),
  memo: z.string().trim().max(500).nullable(),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const id = entryIdSchema.safeParse((await params).id)
  const body = updateSchema.safeParse(await request.json().catch(() => null))
  if (!id.success || !body.success) {
    return NextResponse.json({ error: '수정할 중국 입금내역의 날짜와 금액을 확인해주세요.' }, { status: 400 })
  }

  try {
    const result = await updateChinaFundStatementEntry({
      userId: await getWorkspaceUserId(user.id),
      entryId: id.data,
      ...body.data,
    })
    revalidatePath('/purchasing/payment-flow')
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '중국 입금내역을 수정하지 못했습니다.',
    }, { status: 400 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const id = entryIdSchema.safeParse((await params).id)
  if (!id.success) {
    return NextResponse.json({ error: '삭제할 중국 입금내역이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const result = await voidChinaFundStatementEntry({
      userId: await getWorkspaceUserId(user.id),
      voidedBy: user.id,
      entryId: id.data,
    })
    revalidatePath('/purchasing/payment-flow')
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '중국 입금내역을 삭제하지 못했습니다.',
    }, { status: 400 })
  }
}
