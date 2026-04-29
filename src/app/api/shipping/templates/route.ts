/**
 * GET /api/shipping/templates
 *
 * 현재 로그인 유저의 택배사 엑셀 양식 목록을 반환.
 * 주문 페이지의 일괄 엑셀 다운로드 드롭다운에서 사용자 양식을 노출하기 위한 경량 엔드포인트.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCarrierTemplates } from '@/lib/shipping/template-queries'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const templates = await getCarrierTemplates(user.id)
  return NextResponse.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      carrierId: t.carrierId,
    })),
  })
}
