import type { Metadata } from 'next'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  getChinaOutboundShipmentDetail,
  getSaasChinaInventory,
  listChinaOutboundShipments,
} from '@/lib/purchasing/saas-china-outbound'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { ChinaShipmentsBoard, type ChinaShipmentDetailView, type ChinaShipmentListItem, type ChinaShipmentStockItem } from './china-shipments-board'

export const metadata: Metadata = {
  title: '중국출고',
}

export default async function ChinaShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const params = await searchParams
  const selectedShipmentId = parseShipmentId(stringParam(params.shipment))
  const selectedStep = stringParam(params.step) === 'packing' ? 'packing' : 'setup'
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [{ items: inventoryItems, summary }, shipments, detail] = await Promise.all([
    getSaasChinaInventory(workspaceUserId),
    listChinaOutboundShipments(workspaceUserId),
    selectedShipmentId ? getChinaOutboundShipmentDetail({ userId: workspaceUserId, shipmentId: selectedShipmentId }) : Promise.resolve(null),
  ])

  const stockItems: ChinaShipmentStockItem[] = inventoryItems.map((item) => ({
    id: item.id,
    warehouseCode: item.warehouseCode,
    sku: item.sku,
    productName: item.productName,
    optionName: item.optionName,
    onHandQuantity: item.onHandQuantity,
    reservedQuantity: item.reservedQuantity,
    availableQuantity: item.availableQuantity,
  }))
  const shipmentItems: ChinaShipmentListItem[] = shipments.map((shipment) => ({
    id: shipment.id,
    shipmentNo: shipment.shipmentNo,
    status: shipment.status,
    originWarehouseCode: shipment.originWarehouseCode,
    destinationName: shipment.destinationName,
    plannedOutboundDate: shipment.plannedOutboundDate,
    createdAt: shipment.createdAt.toISOString(),
    itemCount: shipment.itemCount,
    reservedQuantity: shipment.reservedQuantity,
    packedQuantity: shipment.packedQuantity,
  }))

  return (
    <div className="space-y-4">
      <ProductFlowNav />
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">중국출고</h1>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">SaaS 재고 전용</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          중국재고(SaaS)의 상품을 한 출고작업에 예약한 뒤, 파렛트·박스 구성과 박스별 적재 상품을 단계별로 기록합니다. 기존 중국재고와 로우데이터에는 영향을 주지 않습니다.
        </p>
      </header>

      <ChinaShipmentsBoard
        inventoryItems={stockItems}
        inventorySummary={summary}
        shipments={shipmentItems}
        selectedShipment={detail ? toShipmentDetailView(detail) : null}
        selectedStep={selectedStep}
      />
    </div>
  )
}

function toShipmentDetailView(detail: NonNullable<Awaited<ReturnType<typeof getChinaOutboundShipmentDetail>>>): ChinaShipmentDetailView {
  return {
    shipment: {
      id: detail.shipment.id,
      shipmentNo: detail.shipment.shipmentNo,
      status: detail.shipment.status,
      originWarehouseCode: detail.shipment.originWarehouseCode,
      destinationName: detail.shipment.destinationName,
      destinationAddress: detail.shipment.destinationAddress,
      forwarderName: detail.shipment.forwarderName,
      externalReference: detail.shipment.externalReference,
      plannedOutboundDate: detail.shipment.plannedOutboundDate,
      memo: detail.shipment.memo,
      createdAt: detail.shipment.createdAt.toISOString(),
    },
    items: detail.items.map((item) => ({
      id: item.id,
      warehouseCode: item.warehouseCode,
      sku: item.sku,
      productName: item.productName,
      optionName: item.optionName,
      reservedQuantity: item.reservedQuantity,
      packedQuantity: item.packedQuantity,
      dispatchedQuantity: item.dispatchedQuantity,
    })),
    pallets: detail.pallets.map((pallet) => ({ id: pallet.id, palletNo: pallet.palletNo, note: pallet.note })),
    boxes: detail.boxes.map((box) => ({ id: box.id, palletId: box.palletId, boxNo: box.boxNo, status: box.status, note: box.note })),
    boxItems: detail.boxItems.map((item) => ({ id: item.id, boxId: item.boxId, shipmentItemId: item.shipmentItemId, quantity: item.quantity })),
  }
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parseShipmentId(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined
}
