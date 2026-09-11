import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { voidPurchaseFundCredit } from '@/lib/purchasing/purchase-fund-ledger'
import { createClient } from '@/lib/supabase/server'

const idSchema = z.string().uuid()

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const parsedId = idSchema.safeParse((await params).id)
  if (!parsedId.success) {
    return NextResponse.json({ error: '입금 내역 식별값이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const row = await voidPurchaseFundCredit({
      userId: await getWorkspaceUserId(user.id),
      voidedBy: user.id,
      entryId: parsedId.data,
    })
    if (!row) return NextResponse.json({ error: '취소할 입금 내역을 찾을 수 없습니다.' }, { status: 404 })
    revalidatePath('/purchasing/payment-flow')
    return NextResponse.json({ id: row.id })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '입금 내역을 취소하지 못했습니다.',
    }, { status: 500 })
  }
}
