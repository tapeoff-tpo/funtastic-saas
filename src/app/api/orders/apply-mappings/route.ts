/**
 * POST /api/orders/apply-mappings
 *
 * 주문 항목에 매핑(옵션매핑 + 상품명매핑)을 적용해서 SKU 를 사장님 내부
 * 재고관리코드로 갈아끼우고, 매핑이 끝난 신규 주문을 자동 확정 + 자동 합포장.
 *
 * 본 라우트는 thin wrapper — 핵심 로직은 `@/lib/orders/apply-mappings` 의
 * `applyMappingsForUser` 함수에 있으며, 매핑 저장 라우트들에서도 동일 함수를
 * 직접 호출한다.
 *
 * Body (optional): { orderIds?: string[] }  — 특정 주문만 대상으로.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyMappingsForUser } from '@/lib/orders/apply-mappings'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { orderIds?: string[] } = {}
  try { body = await req.json() } catch { /* optional body */ }

  const result = await applyMappingsForUser(user.id, { orderIds: body.orderIds })
  return NextResponse.json(result)
}
