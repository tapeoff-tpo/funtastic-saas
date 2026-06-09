import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { parseBoxCostRateInput, updateBoxCostRate } from '@/lib/analytics/box-costs'
import { createClient } from '@/lib/supabase/server'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const { id } = await params
    const updated = await updateBoxCostRate(
      await getWorkspaceUserId(user.id),
      id,
      parseBoxCostRateInput(await req.json()),
    )
    if (!updated) return NextResponse.json({ error: '박스비 설정을 찾지 못했습니다.' }, { status: 404 })
    revalidatePath('/analytics')
    return NextResponse.json({ rate: updated })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '박스비 설정을 수정하지 못했습니다.' },
      { status: 400 },
    )
  }
}
