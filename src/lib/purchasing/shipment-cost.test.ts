import { describe, expect, it } from 'vitest'
import { calculateShipmentCost } from './shipment-cost'
import type { ImportDocumentDetail } from './china-import-document'

const packing: ImportDocumentDetail = {
  shipment: { shipmentNo: 'TEST', status: 'dispatched', originWarehouseCode: 'CN', destinationName: null, plannedOutboundDate: null, createdAt: '2026-11-17' },
  items: [
    { id: 'a', sku: 'A', productName: '상품 A', warehouseCode: 'CN', optionName: null, reservedQuantity: 10, packedQuantity: 10 },
    { id: 'b', sku: 'B', productName: '상품 B', warehouseCode: 'CN', optionName: null, reservedQuantity: 4, packedQuantity: 4 },
  ],
  pallets: [{ id: 'p', palletNo: 'P1', lengthCm: 100, widthCm: 100, heightCm: 150 }],
  boxes: [
    { id: 'mix', boxNo: '1', palletId: 'p', status: 'packed', lengthCm: 100, widthCm: 100, heightCm: 100 },
    { id: 'loose', boxNo: '2', palletId: null, status: 'packed', lengthCm: 100, widthCm: 100, heightCm: 50 },
  ],
  boxItems: [
    { id: 'a1', boxId: 'mix', shipmentItemId: 'a', quantity: 10 },
    { id: 'b1', boxId: 'mix', shipmentItemId: 'b', quantity: 2 },
    { id: 'b2', boxId: 'loose', shipmentItemId: 'b', quantity: 2 },
  ],
}
const input = { charges: 2538506, vat: 1136460, exchangeRate: 200, prices: { a: 10, b: 20 }, mixedBoxCbm: { a1: 3, b1: 1 } }

describe('shipment landed costs', () => {
  it('counts outer pallets and loose boxes once and reconciles every won after VAT', () => {
    const result = calculateShipmentCost(packing, input)
    expect(result.cbm).toBe(2)
    expect(result.distributable).toBe(1402046)
    expect(result.rows.map((row) => row.cbm)).toEqual([1.125, 0.875])
    expect(result.rows.reduce((sum, row) => sum + row.allocated, 0)).toBe(1402046)
    expect(result.rows[0].unitCost).toBe((20000 + result.rows[0].allocated) / 10)
  })

  it('requires mixed-box weights and the loaded pallet measurements', () => {
    expect(() => calculateShipmentCost(packing, { ...input, mixedBoxCbm: {} })).toThrow('혼적 박스')
    expect(() => calculateShipmentCost({ ...packing, pallets: [] }, input)).toThrow('실측 규격')
  })
})
