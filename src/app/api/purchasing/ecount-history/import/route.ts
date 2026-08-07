import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { importEcountPurchaseHistory } from '@/lib/purchasing/ecount-purchase-history'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  try {
    const form = await request.formData()
    const files = form.getAll('files').filter((value): value is File => value instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: '이카운트 발주요청조회 엑셀 파일을 선택해주세요.' }, { status: 400 })
    }

    const result = await importEcountPurchaseHistory({
      userId: await getWorkspaceUserId(user.id),
      uploadedByUserId: user.id,
      files: await Promise.all(files.map(async (file) => ({
        fileName: file.name.slice(0, 255),
        fileBuffer: await file.arrayBuffer(),
      }))),
    })
    revalidatePath('/purchasing/purchases')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[ecount-purchase-history-import]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '이카운트 과거 발주 이력을 가져오지 못했습니다.' },
      { status: 500 },
    )
  }
}
