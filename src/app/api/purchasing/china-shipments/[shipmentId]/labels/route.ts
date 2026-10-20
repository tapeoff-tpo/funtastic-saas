import { NextResponse } from 'next/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  chinaOutboundShipmentBoxLabelFilename,
  chinaOutboundShipmentLabelFilename,
  exportChinaOutboundShipmentLabelWorkbook,
} from '@/lib/purchasing/china-outbound-shipment-labels'
import { getPurchasingItemLocationsBySku } from '@/lib/purchasing/items'
import { getChinaOutboundShipmentDetail } from '@/lib/purchasing/saas-china-outbound'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const { shipmentId } = await params
  if (!isUuid(shipmentId)) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })

  const boxId = new URL(request.url).searchParams.get('boxId')
  if (boxId !== null && !isUuid(boxId)) {
    return NextResponse.json({ error: '박스 정보를 확인할 수 없습니다.' }, { status: 400 })
  }

  try {
    const workspaceUserId = await getWorkspaceUserId(user.id)
    const detail = await getChinaOutboundShipmentDetail({ userId: workspaceUserId, shipmentId })
    if (!detail) return NextResponse.json({ error: '출고작업을 찾을 수 없습니다.' }, { status: 404 })

    const selectedBox = boxId ? detail.boxes.find((box) => box.id === boxId) : null
    if (boxId && !selectedBox) {
      return NextResponse.json({ error: '이 출고작업에서 박스를 찾을 수 없습니다.' }, { status: 404 })
    }
    if (selectedBox && !detail.boxItems.some((boxItem) => boxItem.boxId === selectedBox.id)) {
      return NextResponse.json({ error: '내용이 저장된 박스만 부착용 쉽먼트를 내려받을 수 있습니다.' }, { status: 400 })
    }

    const locationsBySku = await getPurchasingItemLocationsBySku(
      workspaceUserId,
      detail.items.map((item) => item.sku),
    )
    const labelDetail = {
      ...detail,
      items: detail.items.map((item) => ({
        ...item,
        location: locationsBySku.get(item.sku.trim()) ?? '',
      })),
    }

    const buffer = selectedBox
      ? await exportChinaOutboundShipmentLabelWorkbook(labelDetail, {
        boxIds: [selectedBox.id],
        includePalletLabels: false,
      })
      : await exportChinaOutboundShipmentLabelWorkbook(labelDetail)
    const filename = selectedBox
      ? chinaOutboundShipmentBoxLabelFilename(detail.shipment.shipmentNo, selectedBox.boxNo)
      : chinaOutboundShipmentLabelFilename(detail.shipment.shipmentNo)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('China outbound shipment label export error:', error)
    return NextResponse.json({ error: '중국출고 부착용 쉽먼트 엑셀을 만들지 못했습니다.' }, { status: 500 })
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
