import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { importCoupangRocketOutboundBatch } from '@/lib/analytics/coupang-rocket-outbound'
import { InvalidExcelWorkbookError } from '@/lib/orders/excel-workbook-buffer'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: '파일을 선택해 주세요.' }, { status: 400 })
  if (!file.name.toLocaleLowerCase('ko-KR').endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Excel .xlsx 파일만 업로드할 수 있습니다.' }, { status: 400 })
  }

  try {
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const result = await importCoupangRocketOutboundBatch({
      userId: workspaceUserId,
      fileName: file.name,
      fileBuffer: await file.arrayBuffer(),
    })
    revalidatePath('/analytics/rocket-outbound')
    revalidatePath('/purchasing/purchases')
    revalidatePath('/purchasing/orders')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[CoupangRocketOutboundImport] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '로켓배송 출고 파일 처리 중 오류가 발생했습니다.' },
      { status: error instanceof InvalidExcelWorkbookError ? 400 : 500 },
    )
  }
}
