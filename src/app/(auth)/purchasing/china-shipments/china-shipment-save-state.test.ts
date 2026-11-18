import { expect, it } from 'vitest'
import type { ChinaOutboundBoxSplitSavedState } from '@/lib/purchasing/china-outbound-save-state'
import type { ChinaShipmentDetailView } from './china-shipments-board'
import { applyChinaShipmentBoxSplitSavedState } from './china-shipment-save-state'

function fixture(): ChinaShipmentDetailView {
  return {
    shipment: { id: 'shipment', shipmentNo: 'OUT', displayName: '출고', status: 'draft', originWarehouseCode: '중국', destinationName: '한국',
      destinationAddress: null, forwarderName: null, externalReference: null, plannedOutboundDate: null, memo: '메모', createdAt: '2026-11-18' },
    items: ['a', 'b'].map((id) => ({ id, inventoryId: `stock-${id}`, warehouseCode: '중국', sku: `SKU-${id}`, productName: '상품',
      chineseProductName: '中文品名', optionName: '대형', reservedQuantity: 10, packedQuantity: 5, dispatchedQuantity: 0, boxSplitStatus: 'in_progress',
      productImage: { sku: `SKU-${id}`, productName: '상품', source: 'product-management', imageUrls: ['/image'] } })),
    boxes: [{ id: 'old', shipmentId: 'shipment', editable: true, boxNo: '1', palletId: 'p1', status: 'open', completionStatus: 'completed', note: '박스 메모', lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 5 }],
    boxItems: [{ id: 'old-a', boxId: 'old', shipmentItemId: 'a', quantity: 5 }, { id: 'old-b', boxId: 'old', shipmentItemId: 'b', quantity: 5 }],
    pallets: [{ id: 'p1', palletNo: '1', note: null, completionStatus: 'completed' }, { id: 'p2', palletNo: '2', note: null, completionStatus: 'completed' }],
  }
}

function saved(): ChinaOutboundBoxSplitSavedState {
  return { shipmentId: 'shipment', shipmentItemId: 'a', shipmentStatus: 'packing', packedQuantity: 10, boxSplitStatus: 'completed',
    boxes: [
      { id: 'old', shipmentId: 'shipment', editable: true, boxNo: '1', palletId: 'p1', status: 'open', completionStatus: 'in_progress', note: '박스 메모', lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 5 },
      { id: 'new', shipmentId: 'shipment', editable: true, boxNo: '2', palletId: null, status: 'open', completionStatus: 'in_progress', note: null, lengthCm: 40, widthCm: 50, heightCm: 60, grossWeightKg: 7.5 },
    ], boxItems: [{ id: 'new-a', boxId: 'new', shipmentItemId: 'a', quantity: 10 }], reopenedPalletIds: ['p1'] }
}

it('applies persisted packing rows immediately while preserving other mixed-box products and enrichment', () => {
  const original = fixture()
  const result = applyChinaShipmentBoxSplitSavedState(original, saved())!
  expect(result.shipment).toMatchObject({ status: 'packing', memo: '메모' })
  expect(result.items[0]).toMatchObject({ packedQuantity: 10, boxSplitStatus: 'completed', reservedQuantity: 10, chineseProductName: '中文品名', productImage: original.items[0].productImage })
  expect(result.items[1]).toBe(original.items[1])
  expect(result.boxItems).toEqual([original.boxItems[1], saved().boxItems[0]])
  expect(result.boxes).toEqual(saved().boxes)
  expect(result.pallets.map((pallet) => pallet.completionStatus)).toEqual(['in_progress', 'completed'])
  expect(original.shipment.status).toBe('draft')
  expect(original.boxItems).toHaveLength(2)
})

it('ignores responses for another shipment or item instead of replacing the current workspace view', () => {
  const original = fixture()
  expect(applyChinaShipmentBoxSplitSavedState(original, { ...saved(), shipmentId: 'other' })).toBe(original)
  expect(applyChinaShipmentBoxSplitSavedState(original, { ...saved(), shipmentItemId: 'other' })).toBe(original)
  expect(applyChinaShipmentBoxSplitSavedState(null, saved())).toBeNull()
})

it('merges consecutive product saves without losing the first save or duplicating physical boxes', () => {
  const first = applyChinaShipmentBoxSplitSavedState(fixture(), saved())!
  const second = applyChinaShipmentBoxSplitSavedState(first, { ...saved(), shipmentItemId: 'b', packedQuantity: 8, boxSplitStatus: 'in_progress',
    boxes: [{ ...saved().boxes[1], grossWeightKg: 12 }], boxItems: [{ id: 'new-b', boxId: 'new', shipmentItemId: 'b', quantity: 8 }], reopenedPalletIds: [] })!
  expect(second.items.map((item) => item.packedQuantity)).toEqual([10, 8])
  expect(second.boxItems).toEqual([saved().boxItems[0], { id: 'new-b', boxId: 'new', shipmentItemId: 'b', quantity: 8 }])
  expect(second.boxes).toHaveLength(2)
  expect(second.boxes[1].grossWeightKg).toBe(12)
})
