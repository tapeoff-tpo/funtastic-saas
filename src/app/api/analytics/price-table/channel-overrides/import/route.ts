import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import {
  createChannelBundleOverrideTemplate,
  importChannelBundleOverrides,
} from '@/lib/analytics/channel-product-overrides'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_EXTENSIONS = new Set(['xlsx', 'xls', 'csv'])

async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  return new NextResponse(createChannelBundleOverrideTemplate(), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': "attachment; filename*=UTF-8''channel-bundle-overrides-template.xlsx",
    },
  })
}

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '업로드할 채널 묶음상품 파일을 선택해주세요.' }, { status: 400 })
    }
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json({ error: 'xlsx, xls, csv 파일만 업로드할 수 있습니다.' }, { status: 400 })
    }

    const result = await importChannelBundleOverrides({
      userId: await getWorkspaceUserId(user.id),
      fileBuffer: await file.arrayBuffer(),
    })
    revalidatePath('/analytics/price-table')
    return NextResponse.json(result)
  } catch (error) {
    console.error('channel bundle override import error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '채널 묶음상품 업로드에 실패했습니다.' },
      { status: 500 },
    )
  }
}
