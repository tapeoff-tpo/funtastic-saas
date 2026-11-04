import { getChinaOutboundShipmentDetail, getSaasChinaInventory } from '@/lib/purchasing/saas-china-outbound'
import { getPurchasingItemLabelDataBySku } from '@/lib/purchasing/items'
import { findSavedNewProductImagesBatch } from '@/lib/new-products/catalogue-images'
import type { ProductImageResult } from '@/lib/purchasing/product-image-catalogue'
import { dimensionNumber } from '@/lib/purchasing/china-outbound-dimensions'
import type { ChinaShipmentDetailView, ChinaShipmentStockItem } from './china-shipments-board'

export async function loadChinaShipmentDetailView(userId: string, shipmentId: string) {
  const detail = await getChinaOutboundShipmentDetail({ userId, shipmentId })
  if (!detail) return null
  const [images, names] = await Promise.all([
    findSavedNewProductImagesBatch(userId, detail.items).catch((error) => { console.error('outbound image address preload failed', error); return {} }),
    getPurchasingItemLabelDataBySku(userId, detail.items.map((item) => item.sku)),
  ])
  return toShipmentDetailView(detail, images, names)
}

export async function loadChinaShipmentStockItems(userId: string): Promise<ChinaShipmentStockItem[]> {
  const { items } = await getSaasChinaInventory(userId)
  const names = await getPurchasingItemLabelDataBySku(userId, items.map((item) => item.sku))
  return items.map((item) => ({
    id: item.id, warehouseCode: item.warehouseCode, sku: item.sku, productName: item.productName,
    chineseProductName: names.get(item.sku)?.chineseProductName ?? '', lastReceivedAt: item.lastReceivedAt?.toISOString() ?? null,
    optionName: item.optionName, onHandQuantity: item.onHandQuantity, reservedQuantity: item.reservedQuantity, availableQuantity: item.availableQuantity,
  }))
}

function toShipmentDetailView(detail: NonNullable<Awaited<ReturnType<typeof getChinaOutboundShipmentDetail>>>, productImages: Record<string, ProductImageResult>, names: Map<string, { chineseProductName: string }>): ChinaShipmentDetailView {
  return {
    shipment: {
      id: detail.shipment.id,
      displayName: detail.shipment.displayName,
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
      inventoryId: item.inventoryId,
      itemCategory: item.itemCategory,
      warehouseCode: item.warehouseCode,
      sku: item.sku,
      productName: item.productName,
      chineseProductName: item.chineseProductName || names.get(item.sku)?.chineseProductName || '',
      optionName: item.optionName,
      reservedQuantity: item.reservedQuantity,
      packedQuantity: item.packedQuantity,
      dispatchedQuantity: item.dispatchedQuantity,
      boxSplitStatus: item.boxSplitStatus === 'completed' || item.boxSplitStatus === 'in_progress'
        ? item.boxSplitStatus
        : item.packedQuantity === item.reservedQuantity ? 'completed' : 'in_progress',
      onHandQuantity: item.onHandQuantity,
      availableQuantity: item.availableQuantity,
      receiptPacking: item.receiptPacking,
      productImage: productImages[item.id],
    })),
    pallets: detail.pallets.map((pallet) => ({ id: pallet.id, palletNo: pallet.palletNo, note: pallet.note, lengthCm: dimensionNumber(pallet.lengthCm), widthCm: dimensionNumber(pallet.widthCm), heightCm: dimensionNumber(pallet.heightCm), grossWeightKg: dimensionNumber(pallet.grossWeightKg), completionStatus: pallet.completionStatus === 'completed' || pallet.completionStatus === 'in_progress' ? pallet.completionStatus : null })),
    boxes: detail.boxes.map((box) => ({
      id: box.id,
      shipmentId: detail.shipment.id,
      editable: detail.shipment.status === 'draft' || detail.shipment.status === 'packing',
      palletId: box.palletId,
      boxNo: box.boxNo,
      status: box.status,
      completionStatus: box.completionStatus === 'completed' || box.completionStatus === 'in_progress' ? box.completionStatus : null,
      note: box.note,
      grossWeightKg: dimensionNumber(box.grossWeightKg),
      lengthCm: dimensionNumber(box.lengthCm),
      widthCm: dimensionNumber(box.widthCm),
      heightCm: dimensionNumber(box.heightCm),
    })),
    boxItems: detail.boxItems.map((item) => ({ id: item.id, boxId: item.boxId, shipmentItemId: item.shipmentItemId, quantity: item.quantity })),
  }
}

