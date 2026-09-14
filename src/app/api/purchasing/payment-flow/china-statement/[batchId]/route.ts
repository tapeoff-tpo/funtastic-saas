import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { voidLatestChinaFundStatementBatch } from '@/lib/purchasing/china-fund-statement'
import { createClient } from '@/lib/supabase/server'

const batchIdSchema = z.string().uuid()

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const batchId = batchIdSchema.safeParse((await params).batchId)
  if (!batchId.success) {
    return NextResponse.json({ error: '취소할 입력 묶음이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const result = await voidLatestChinaFundStatementBatch({
      userId: await getWorkspaceUserId(user.id),
      voidedBy: user.id,
      importBatchId: batchId.data,
    })
    revalidatePath('/purchasing/payment-flow')
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '중국 정산내역을 취소하지 못했습니다.',
    }, { status: 400 })
  }
}
