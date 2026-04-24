/**
 * POST /api/products/carriers/import
 *
 * 채워진 택배사 지정 엑셀을 업로드 받아 products.default_carrier_id 를 일괄 업데이트.
 * multipart/form-data 의 "file" 필드로 .xlsx 파일 전달.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyCarrierImport } from '@/lib/products/carrier-excel'
import { revalidatePath } from 'next/cache'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 })
    }
    const buffer = await file.arrayBuffer()
    const result = await applyCarrierImport(user.id, buffer)
    revalidatePath('/products')
    return NextResponse.json(result)
  } catch (err) {
    console.error('carrier import error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '업로드 실패' },
      { status: 500 },
    )
  }
}
