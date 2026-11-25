import { expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { exportKoreaShippingDocument, koreaShippingRows, formatKoreaBoxNumbers } from './korea-shipping-document'
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

it('merges exact option SKUs within each pallet and merges the pallet heading', async () => {
  const source: ImportDocumentDetail = {
    ...detail,
    items: [...detail.items, { ...detail.items[0], id: 'duplicate', optionName: '흰색', location: 'A-01' }, { ...detail.items[0], id: 'other-option', sku: '100-0002', optionName: '검정', location: 'A-02' }],
    boxItems: [...detail.boxItems, { id: 'extra', boxId: 'b', shipmentItemId: 'duplicate', quantity: 2 }, { id: 'option', boxId: 'b', shipmentItemId: 'other-option', quantity: 4 }],
  }
  const rows = koreaShippingRows(source, 'pallet')
  expect(rows.filter((row) => row.pallet === '1' && row.sku === '100-0001')).toHaveLength(1)
  expect(rows.find((row) => row.sku === '100-0001')).toMatchObject({ quantity: 5, location: 'A-01' })
  expect(rows.find((row) => row.sku === '100-0002')).toMatchObject({ quantity: 4, location: 'A-02' })
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportKoreaShippingDocument(source) as unknown as ExcelJS.Buffer)
  for (const sheet of workbook.worksheets) {
    expect(sheet.getCell('A4').master.address).toBe('A3')
    expect(sheet.getCell('A5').master.address).toBe('A3')
    expect(sheet.getCell('K3').value).toBe('A-01')
  }
})


it('compresses consecutive boxes while keeping gaps and nonnumeric labels', () => {
  expect(formatKoreaBoxNumbers(['5', '2', '1', '4', '3', '8', '10', '9', 'BOX-A'])).toBe('1-5, 8-10, BOX-A')
  expect(formatKoreaBoxNumbers(['001', '002'])).toBe('001, 002')
})

it('combines matching product names and options across different SKUs without mixing options or pallets', async () => {
  const source: ImportDocumentDetail = {
    ...detail,
    boxes: [...detail.boxes, { id: 'd', boxNo: '3', palletId: 'p', status: 'open' }],
    items: [...detail.items, { ...detail.items[0], id: 'same', sku: '999-0001', location: 'A-01' }, { ...detail.items[0], id: 'black', sku: '999-0002', optionName: '검정' }],
    boxItems: [...detail.boxItems, { id: 's', boxId: 'd', shipmentItemId: 'same', quantity: 2 }, { id: 't', boxId: 'd', shipmentItemId: 'black', quantity: 4 }],
  }
  const rows = koreaShippingRows(source, 'pallet')
  expect(rows.filter((row) => row.name === '컵' && row.option === '흰색')).toHaveLength(1)
  expect(rows.find((row) => row.option === '흰색')).toMatchObject({ quantity: 5, sku: '100-0001, 999-0001', boxes: ['1', '3'], location: 'A-01' })
  expect(rows.find((row) => row.option === '검정')?.quantity).toBe(4)
  expect(koreaShippingRows(source, 'box').filter((row) => row.name === '컵' && row.option === '흰색')).toHaveLength(1)
})

it('shows box dimensions and reconciles mixed-box weights without double counting', async () => {
  const source: ImportDocumentDetail = { ...detail, boxes: [
    { ...detail.boxes[0], lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 12 },
    { ...detail.boxes[1], lengthCm: 20, widthCm: 15, heightCm: 10, grossWeightKg: 5 },
  ] }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportKoreaShippingDocument(source) as unknown as ExcelJS.Buffer)
  for (const sheet of workbook.worksheets) {
    expect(sheet.getCell('L3').value).toBe('50 × 1박스')
    expect(sheet.getCell('M3').value).toBe('40 × 1박스')
    expect(sheet.getCell('N3').value).toBe('30 × 1박스')
    expect(sheet.getCell('O3').value).toBe(9)
    expect(sheet.getCell('O4').value).toBe(3)
    expect(sheet.getCell('O6').value).toMatchObject({ result: 17 })
    expect(sheet.pageSetup.printArea).toContain('O6')
  }
})
