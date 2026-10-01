import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  chinaOutboundWorkFilename,
  exportChinaOutboundWorkWorkbook,
  parseChinaOutboundWorkWorkbook,
} from '@/lib/purchasing/china-outbound-workbook'
import {
  applyChinaOutboundWorkbook,
  getChinaOutboundShipmentDetail,
} from '@/lib/purchasing/saas-china-outbound'

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shipmentId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const { shipmentId } = await params
  if (!isUuid(shipmentId)) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })

  try {
    const detail = await getChinaOutboundShipmentDetail({
      userId: await getWorkspaceUserId(user.id),
      shipmentId,
    })
    if (!detail) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })

    const buffer = await exportChinaOutboundWorkWorkbook(detail)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(chinaOutboundWorkFilename(detail.shipment.shipmentNo))}`,
      },
    })
  } catch (error) {
    console.error('China outbound work workbook export error:', error)
    return NextResponse.json({ error: '중국출고 작업용 엑셀을 만들지 못했습니다.' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const { shipmentId } = await params
  if (!isUuid(shipmentId)) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })

  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: '업로드할 엑셀 파일을 선택해주세요.' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: '엑셀 파일은 10MB 이하만 업로드할 수 있습니다.' }, { status: 400 })

    const workspaceUserId = await getWorkspaceUserId(user.id)
    const detail = await getChinaOutboundShipmentDetail({ userId: workspaceUserId, shipmentId })
    if (!detail) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })

    const preview = await parseChinaOutboundWorkWorkbook({
      fileBuffer: await file.arrayBuffer(),
      detail,
    })
    const mode = form.get('mode') === 'apply' ? 'apply' : 'preview'
    if (mode === 'preview') return NextResponse.json({ ok: preview.errors.length === 0, preview })
    if (preview.errors.length > 0) {
      return NextResponse.json({ error: '엑셀 오류를 먼저 수정해주세요.', preview }, { status: 400 })
    }

    const result = await applyChinaOutboundWorkbook({
      userId: workspaceUserId,
      shipmentId,
      boxSplits: preview.boxSplits,
      palletAssignments: preview.palletAssignments,
    })
    revalidateChinaShipmentPaths()
    return NextResponse.json({ ok: true, preview, result })
  } catch (error) {
    console.error('China outbound work workbook import error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : '중국출고 작업용 엑셀 업로드에 실패했습니다.' }, { status: 500 })
  }
}

function revalidateChinaShipmentPaths() {
  revalidatePath('/purchasing/saas-china-inventory')
  revalidatePath('/purchasing/china-shipments')
  revalidatePath('/purchasing/orders')
  revalidatePath('/purchasing/payment-flow')
  revalidatePath('/purchasing/overdue')
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
