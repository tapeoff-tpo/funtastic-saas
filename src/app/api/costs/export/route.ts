import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { exportProductCostsToExcel } from '@/lib/products/cost-export'
import type { ProductFilters } from '@/lib/products/types'

const SORT_KEYS = new Set(['internalSku', 'name', 'costPrice', 'warehouseLocation'])

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const sort = searchParams.get('sort')
  const order = searchParams.get('order')
  const filters: ProductFilters = {
    search: searchParams.get('search')?.trim() || undefined,
    sort: sort && SORT_KEYS.has(sort) ? sort : undefined,
    order: order === 'desc' ? 'desc' : 'asc',
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const buffer = await exportProductCostsToExcel(workspaceUserId, filters)
  const date = new Date().toISOString().slice(0, 10)
  const filename = `품목_${date}.xlsx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
