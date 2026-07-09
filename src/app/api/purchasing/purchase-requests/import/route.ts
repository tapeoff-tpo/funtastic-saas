import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/supabase/server'
import { importPurchaseRequestsExcel } from '@/lib/purchasing/purchase-request-excel'
import { PURCHASE_REQUEST_STATUSES, type PurchaseRequestStatus } from '@/lib/purchasing/purchase-request-status'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '업로드할 엑셀 파일을 선택해주세요.' }, { status: 400 })
    }

    const result = await importPurchaseRequestsExcel({
      userId: await getWorkspaceUserId(user.id),
      fileBuffer: await file.arrayBuffer(),
      defaultStatus: parseStatus(request.nextUrl.searchParams.get('defaultStatus')),
    })

    revalidatePath('/purchasing/purchases')
    revalidatePath('/purchasing/orders')
    revalidatePath('/purchasing/overdue')

    return NextResponse.json(result)
  } catch (error) {
    console.error('[purchase-requests-import]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '발주 엑셀 업로드에 실패했습니다.' },
      { status: 500 },
    )
  }
}

function parseStatus(value: string | null): PurchaseRequestStatus | undefined {
  if (!value) return undefined
  return (PURCHASE_REQUEST_STATUSES as readonly string[]).includes(value)
    ? value as PurchaseRequestStatus
    : undefined
}
