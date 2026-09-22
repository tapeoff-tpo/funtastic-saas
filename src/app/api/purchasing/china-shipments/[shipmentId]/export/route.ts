import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  chinaOutboundPackingFilename,
  exportChinaOutboundPackingWorkbook,
} from '@/lib/purchasing/china-outbound-packing-export'
import { getChinaOutboundShipmentDetail } from '@/lib/purchasing/saas-china-outbound'

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
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const detail = await getChinaOutboundShipmentDetail({ userId: workspaceUserId, shipmentId })
    if (!detail) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })

    const buffer = await exportChinaOutboundPackingWorkbook(detail)
    const filename = chinaOutboundPackingFilename(detail.shipment.shipmentNo)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (error) {
    console.error('China outbound packing export error:', error)
    return NextResponse.json({ error: '중국출고 적재현황을 엑셀로 만들지 못했습니다.' }, { status: 500 })
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
