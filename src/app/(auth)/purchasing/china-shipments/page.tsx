import type { Metadata } from 'next'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import {
  listSaasChinaOutboundWarehouses,
  listChinaOutboundShipments,
} from '@/lib/purchasing/saas-china-outbound'
import { ChinaShipmentsBoard, type ChinaShipmentListItem, type ChinaShipmentStage } from './china-shipments-board'

import { loadChinaShipmentDetailView, loadChinaShipmentStockItems } from './china-shipment-data'

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
  const showCreate = stringParam(params.create) === '1'
  const selectedShipmentId = showCreate ? undefined : parseShipmentId(stringParam(params.shipment))
  const selectedStep = parseShipmentStage(stringParam(params.step))
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [stockItems, shipments, selectedShipment, outboundWarehouses] = await Promise.all([
    showCreate ? loadChinaShipmentStockItems(workspaceUserId) : Promise.resolve([]),
    listChinaOutboundShipments(workspaceUserId),
    selectedShipmentId ? loadChinaShipmentDetailView(workspaceUserId, selectedShipmentId) : Promise.resolve(null),
    listSaasChinaOutboundWarehouses(workspaceUserId),
  ])
  const shipmentItems: ChinaShipmentListItem[] = shipments.map((shipment) => ({
    id: shipment.id,
    displayName: shipment.displayName,
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
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">중국출고</h1>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">SaaS 재고 전용</span>
        </div>
      </header>

      <ChinaShipmentsBoard
        inventoryItems={stockItems}
        shipments={shipmentItems}
        selectedShipment={selectedShipment}
        selectedStep={selectedStep}
        showCreate={showCreate}
        outboundWarehouses={outboundWarehouses}
      />
    </div>
  )
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parseShipmentId(value: string | undefined) {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined
}

function parseShipmentStage(value: string | undefined): ChinaShipmentStage {
  if (value === 'items' || value === 'boxes' || value === 'pallets' || value === 'summary') return value
  // Keep old bookmarks useful after replacing the former two-step screen.
  if (value === 'setup' || value === 'packing') return 'boxes'
  return 'items'
}
