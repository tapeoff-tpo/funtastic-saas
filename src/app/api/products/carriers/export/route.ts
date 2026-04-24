/**
 * GET /api/products/carriers/export
 *
 * 택배사 미지정 상품 (default_carrier_id IS NULL) 을 엑셀로 다운로드.
 * 사용자가 택배사 열을 채워 /api/products/carriers/import 로 업로드하면 일괄 적용.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exportUnassignedCarriersToExcel } from '@/lib/products/carrier-excel'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  try {
    const buffer = await exportUnassignedCarriersToExcel(user.id)
    const date = new Date()
    const dateStr = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('')
    const filename = `택배사_미지정_${dateStr}.xlsx`
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err) {
    console.error('carrier export error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '내보내기 실패' },
      { status: 500 },
    )
  }
}
