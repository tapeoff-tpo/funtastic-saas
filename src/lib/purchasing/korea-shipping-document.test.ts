import { expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { exportKoreaShippingDocument, koreaShippingRows } from './korea-shipping-document'
import type { ImportDocumentDetail } from './china-import-document'
const detail: ImportDocumentDetail = {
  shipment: { shipmentNo: 'CN-1', status: 'packing', originWarehouseCode: '중국', destinationName: '인천', plannedOutboundDate: '2026-11-20', createdAt: '2026-11-20' },
  pallets: [{ id: 'p', palletNo: '1' }],
  boxes: [{ id: 'b', boxNo: '1', palletId: 'p', status: 'open' }, { id: 'c', boxNo: '2', palletId: null, status: 'open' }],
  items: [{ id: 'a', sku: '100-0001', productName: '컵', optionName: '흰색', warehouseCode: '쿠팡', reservedQuantity: 3, packedQuantity: 3 }, { id: 'x', sku: '200', productName: '접시', optionName: '', warehouseCode: '중국', reservedQuantity: 2, packedQuantity: 2 }],
  boxItems: [{ id: 'l', boxId: 'b', shipmentItemId: 'a', quantity: 3 }, { id: 'm', boxId: 'b', shipmentItemId: 'x', quantity: 1 }, { id: 'n', boxId: 'c', shipmentItemId: 'x', quantity: 1 }],
}
it('keeps mixed-box SKUs and classifies only warehouse, Coupang and bulk', async () => {
  const rows = koreaShippingRows(detail, 'pallet')
  expect(rows[0]).toMatchObject({ pallet: '1', quantity: 3, coupang: 3, warehouse: 0 })
  expect(rows.at(-1)).toMatchObject({ pallet: 'BOX', warehouse: 1 })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportKoreaShippingDocument(detail) as unknown as ExcelJS.Buffer)
  expect(workbook.worksheets).toHaveLength(2)
  const sheet = workbook.worksheets[0]
  expect(sheet.getRow(2).values).toContain('쿠팡')
  expect(sheet.getRow(2).values).not.toContain('무게(kg)')
  expect(sheet.getCell('C6').value).toMatchObject({ result: 2 })
  expect(sheet.getCell('G6').value).toMatchObject({ result: 5 })
})
