import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { importActualShippingCosts } from '@/lib/shipping/actual-costs'
import { ACTUAL_SHIPPING_COST_CARRIERS, type ActualShippingCostCarrier } from '@/lib/shipping/actual-cost-types'

const carrierIds = new Set(ACTUAL_SHIPPING_COST_CARRIERS.map((carrier) => carrier.id))

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const form = await req.formData()
    const carrierId = String(form.get('carrierId') ?? '') as ActualShippingCostCarrier
    const file = form.get('file')

    if (!carrierIds.has(carrierId)) {
      return NextResponse.json({ error: '택배사를 선택해주세요.' }, { status: 400 })
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '엑셀 파일을 선택해주세요.' }, { status: 400 })
    }

    const result = await importActualShippingCosts({
      userId: await getWorkspaceUserId(user.id),
      carrierId,
      fileBuffer: await file.arrayBuffer(),
      sourceFileName: file.name,
    })

    revalidatePath('/analytics')
    revalidateTag('analytics', { expire: 0 })
    return NextResponse.json(result)
  } catch (error) {
    console.error('actual shipping cost import error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '실제배송비 업로드에 실패했습니다.' },
      { status: 500 },
    )
  }
}
