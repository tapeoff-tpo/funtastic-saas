import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { createClient } from '@/lib/supabase/server'
import { exportPurchaseRequestsExcel } from '@/lib/purchasing/purchase-request-excel'
import { PURCHASE_REQUEST_STATUSES, type PurchaseRequestStatus } from '@/lib/purchasing/purchase-request-status'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const params = request.nextUrl.searchParams
  const status = parseStatus(params.get('status'))
  const overdueOnly = params.get('overdueOnly') === '1'
  const search = params.get('search')?.trim() || undefined
  const buffer = await exportPurchaseRequestsExcel({
    userId: await getWorkspaceUserId(user.id),
    status,
    overdueOnly,
    search,
  })
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const name = overdueOnly ? '구매입고지연' : status ? `발주_${status}` : '발주전체'

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${name}_${date}.xlsx`)}`,
    },
  })
}

function parseStatus(value: string | null): PurchaseRequestStatus | undefined {
  if (!value) return undefined
  return (PURCHASE_REQUEST_STATUSES as readonly string[]).includes(value)
    ? value as PurchaseRequestStatus
    : undefined
}
