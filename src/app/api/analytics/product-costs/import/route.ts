import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  return NextResponse.json(
    { error: '상품 원가는 발주 > 품목의 ESA009M 업로드에서만 관리됩니다.' },
    { status: 409 },
  )
}
