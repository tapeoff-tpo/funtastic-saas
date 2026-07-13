import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { importPriceTableRows } from '@/lib/analytics/price-table'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_EXTENSIONS = new Set(['xlsb', 'xlsx', 'xls'])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '업로드할 판매가 테이블 파일을 선택해주세요.' }, { status: 400 })
    }

    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json({ error: 'xlsb, xlsx, xls 파일만 업로드할 수 있습니다.' }, { status: 400 })
    }

    const result = await importPriceTableRows({
      userId: await getWorkspaceUserId(user.id),
      fileBuffer: await file.arrayBuffer(),
      sourceFileName: file.name,
    })

    revalidatePath('/analytics/price-table')
    return NextResponse.json(result)
  } catch (error) {
    console.error('price table import error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '판매가 테이블 업로드에 실패했습니다.' },
      { status: 500 },
    )
  }
}
