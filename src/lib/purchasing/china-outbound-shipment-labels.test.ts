import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS,
  type ChinaOutboundShipmentLabelDetail,
  chinaOutboundShipmentLabelFilename,
  exportChinaOutboundShipmentLabelWorkbook,
} from './china-outbound-shipment-labels'

const detail: ChinaOutboundShipmentLabelDetail = {
  shipment: {
    shipmentNo: 'CN-20261015-TEST',
    status: 'packing',
    originWarehouseCode: '중국창고A',
    destinationName: '한국 1창고',
    plannedOutboundDate: '2026-10-15',
    createdAt: '2026-10-15T00:00:00.000Z',
  },
  items: [
    { id: 'item-a', warehouseCode: '중국창고A', sku: '100001-0001', productName: '상품 A', optionName: '블랙', reservedQuantity: 100, packedQuantity: 100 },
    { id: 'item-b', warehouseCode: '중국창고A', sku: '100002-0001', productName: '상품 B', optionName: '화이트', reservedQuantity: 95, packedQuantity: 95 },
  ],
  pallets: [
    { id: 'pallet-1', palletNo: '파렛트 1' },
    { id: 'pallet-2', palletNo: '파렛트 2' },
  ],
  boxes: [
    { id: 'box-1', palletId: 'pallet-1', boxNo: '박스 1', status: 'open' },
    { id: 'box-2', palletId: 'pallet-1', boxNo: '박스 2', status: 'open' },
    { id: 'box-3', palletId: 'pallet-2', boxNo: '박스 3', status: 'open' },
    { id: 'box-4', palletId: null, boxNo: '박스 4', status: 'open' },
  ],
  boxItems: [
    { id: 'box-item-1', boxId: 'box-1', shipmentItemId: 'item-a', quantity: 60 },
    { id: 'box-item-2', boxId: 'box-1', shipmentItemId: 'item-b', quantity: 5 },
    { id: 'box-item-3', boxId: 'box-2', shipmentItemId: 'item-a', quantity: 40 },
    { id: 'box-item-4', boxId: 'box-3', shipmentItemId: 'item-b', quantity: 45 },
    { id: 'box-item-5', boxId: 'box-4', shipmentItemId: 'item-b', quantity: 45 },
  ],
}

describe('China outbound shipment label workbook', () => {
  it('creates editable, one-label-per-page box and pallet shipment sheets', async () => {
    const buffer = await exportChinaOutboundShipmentLabelWorkbook(detail)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      CHINA_OUTBOUND_SHIPMENT_LABEL_SHEETS.guide,
      '박스 쉽먼트 01',
      '박스 쉽먼트 02',
      '박스 쉽먼트 03',
      '박스 쉽먼트 04',
      '파렛트 쉽먼트 01',
      '파렛트 쉽먼트 02',
    ])

    const boxSheet = workbook.getWorksheet('박스 쉽먼트 01')!
    expect(boxSheet.getCell('A1').value).toBe('박스 쉽먼트 · 박스 1')
    expect(boxSheet.getCell('A4').value).toBe('중국어 상품명')
    expect(boxSheet.getCell('B5').value).toBe(60)
    expect(boxSheet.getCell('C5').value).toBe('상품 A (블랙)')
    expect(boxSheet.getCell('D5').value).toBe('박스 1')
    expect(fillColor(boxSheet.getCell('A5'))).toBe('FFFFF2CC')
    expect(fillColor(boxSheet.getCell('E5'))).toBe('FFFFF2CC')
    expect(workbook.getWorksheet('박스 쉽먼트 04')!.getCell('A1').value).toBe('박스 쉽먼트 · 박스 4')
    expect(boxSheet.pageSetup.orientation).toBe('landscape')
    expect(boxSheet.pageSetup.paperSize).toBe(9)
    expect(boxSheet.pageSetup.fitToWidth).toBe(1)
    expect(boxSheet.pageSetup.fitToHeight).toBe(1)

    const palletSheet = workbook.getWorksheet('파렛트 쉽먼트 01')!
    expect(palletSheet.getCell('A1').value).toBe('파렛트 쉽먼트 · 파렛트 1')
    expect(palletSheet.getCell('A4').value).toBe('번호')
    expect(palletSheet.getCell('A5').value).toBe('파렛트 1')
    expect(palletSheet.getCell('B5').value).toBe(2)
    expect(fillColor(palletSheet.getCell('C5'))).toBe('FFFFF2CC')
    expect(palletSheet.getCell('D5').value).toBe('상품 A')
    expect(palletSheet.getCell('E5').value).toBe('블랙')
    expect(palletSheet.getCell('F5').value).toBe(100)
    expect(palletSheet.getCell('D6').value).toBe('상품 B')
    expect(palletSheet.getCell('F6').value).toBe(5)
    expect(workbook.getWorksheet('파렛트 쉽먼트 02')!.getCell('A1').value).toBe('파렛트 쉽먼트 · 파렛트 2')
    expect(workbook.getWorksheet('파렛트 쉽먼트 03')).toBeUndefined()
  })

  it('creates a Windows-safe attachment filename', () => {
    expect(chinaOutboundShipmentLabelFilename('CN:10/15', new Date('2026-10-15T00:00:00.000Z')))
      .toBe('CN_10_15_부착용쉽먼트_20261015.xlsx')
  })
})

function fillColor(cell: ExcelJS.Cell) {
  return cell.fill.type === 'pattern' ? cell.fill.fgColor?.argb : undefined
}
