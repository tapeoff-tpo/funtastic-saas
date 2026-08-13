import { revalidatePath, revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  importChannelSalesBatch,
  isChannelSalesChannel,
} from '@/lib/analytics/channel-sales'
import { InvalidExcelWorkbookError } from '@/lib/orders/excel-workbook-buffer'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const channel = String(formData.get('channel') ?? '')
  if (!file) return NextResponse.json({ error: '파일을 선택해 주세요.' }, { status: 400 })
  if (!isChannelSalesChannel(channel)) return NextResponse.json({ error: '올바른 매출 구분을 선택해 주세요.' }, { status: 400 })
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return NextResponse.json({ error: 'Excel .xlsx 또는 CSV 파일만 업로드할 수 있습니다.' }, { status: 400 })
  }

  try {
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const result = await importChannelSalesBatch({
      userId: workspaceUserId,
      channel,
      fileName: file.name,
      fileBuffer: await file.arrayBuffer(),
    })
    revalidateTag('analytics', { expire: 0 })
    revalidatePath('/analytics')
    revalidatePath('/analytics/rocket-outbound')
    return NextResponse.json(result)
  } catch (error) {
    console.error('[ChannelSalesImport] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '매출 파일 처리 중 오류가 발생했습니다.' },
      { status: error instanceof InvalidExcelWorkbookError ? 400 : 500 },
    )
  }
}
