import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createBoxCostRate, listBoxCostRates, parseBoxCostRateInput } from '@/lib/analytics/box-costs'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const userId = await authenticatedWorkspaceUserId()
  if (!userId) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  return NextResponse.json({ rates: await listBoxCostRates(userId) })
}

export async function POST(req: NextRequest) {
  const userId = await authenticatedWorkspaceUserId()
  if (!userId) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const input = parseBoxCostRateInput(await req.json())
    const created = await createBoxCostRate(userId, input)
    revalidatePath('/analytics')
    revalidateTag('analytics', { expire: 0 })
    return NextResponse.json({ rate: created })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '박스비 설정을 저장하지 못했습니다.' },
      { status: 400 },
    )
  }
}

async function authenticatedWorkspaceUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? getWorkspaceUserId(user.id) : null
}
