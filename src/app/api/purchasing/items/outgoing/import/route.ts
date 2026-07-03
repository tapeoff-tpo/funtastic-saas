import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { importPurchasingItemOutgoingMetrics } from '@/lib/purchasing/items'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '출고수량 엑셀 파일을 선택해주세요.' }, { status: 400 })
    }
    const result = await importPurchasingItemOutgoingMetrics({
      userId: await getWorkspaceUserId(user.id),
      fileBuffer: await file.arrayBuffer(),
    })
    revalidatePath('/costs')
    revalidatePath('/purchasing/orders')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[purchasing-items-outgoing-import]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '출고수량 엑셀 업로드에 실패했습니다.' },
      { status: 500 },
    )
  }
}
