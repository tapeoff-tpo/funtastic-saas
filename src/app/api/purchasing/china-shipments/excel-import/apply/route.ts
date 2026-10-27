import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { parseChinaOutboundRegistrationWorkbook } from '@/lib/purchasing/china-outbound-registration-workbook'
import {
  applyChinaOutboundRegistrationWorkbook,
  previewChinaOutboundRegistrationWorkbook,
} from '@/lib/purchasing/saas-china-outbound'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  try {
    const form = await request.formData()
    const file = excelFileFromForm(form)
    if (file instanceof NextResponse) return file
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const workbook = await parseChinaOutboundRegistrationWorkbook(await file.arrayBuffer())
    const preview = await previewChinaOutboundRegistrationWorkbook({
      userId: workspaceUserId,
      workbook,
    })
    if (preview.summary.invalidCount > 0 || preview.errors.length > 0) {
      return NextResponse.json({ error: '엑셀 오류를 먼저 수정해주세요.', preview }, { status: 400 })
    }

    const result = await applyChinaOutboundRegistrationWorkbook({
      userId: workspaceUserId,
      createdBy: user.id,
      workbook,
    })
    revalidateChinaShipmentPaths()
    return NextResponse.json({ ok: true, preview, result })
  } catch (error) {
    console.error('China outbound registration workbook apply error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '중국출고 엑셀을 반영하지 못했습니다.' },
      { status: 400 },
    )
  }
}

function excelFileFromForm(form: FormData): File | NextResponse {
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '업로드할 엑셀 파일을 선택해주세요.' }, { status: 400 })
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) return NextResponse.json({ error: 'xlsx 또는 xlsm 엑셀 파일만 업로드할 수 있습니다.' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: '엑셀 파일은 10MB 이하만 업로드할 수 있습니다.' }, { status: 400 })
  return file
}

function revalidateChinaShipmentPaths() {
  revalidatePath('/purchasing/saas-china-inventory')
  revalidatePath('/purchasing/china-shipments')
  revalidatePath('/purchasing/orders')
  revalidatePath('/purchasing/payment-flow')
  revalidatePath('/purchasing/overdue')
}
