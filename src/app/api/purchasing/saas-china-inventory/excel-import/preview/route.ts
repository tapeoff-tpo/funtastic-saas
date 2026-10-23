import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { parseSaasChinaInventoryWorkbook } from '@/lib/purchasing/saas-china-inventory-excel'
import { previewSaasChinaInventoryWorkbook } from '@/lib/purchasing/saas-china-outbound'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const file = await excelFileFromRequest(request)
    if (file instanceof NextResponse) return file
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const parsed = await parseSaasChinaInventoryWorkbook(await file.arrayBuffer())
    const preview = await previewSaasChinaInventoryWorkbook({ userId: workspaceUserId, rows: parsed.rows })
    return NextResponse.json({ preview })
  } catch (error) {
    console.error('SaaS China inventory Excel preview error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'SaaS 중국재고 엑셀을 검토하지 못했습니다.' },
      { status: 400 },
    )
  }
}

async function excelFileFromRequest(request: NextRequest): Promise<File | NextResponse> {
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '업로드할 엑셀 파일을 선택해주세요.' }, { status: 400 })
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) return NextResponse.json({ error: 'xlsx 또는 xlsm 엑셀 파일만 업로드할 수 있습니다.' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: '엑셀 파일은 10MB 이하만 업로드할 수 있습니다.' }, { status: 400 })
  return file
}