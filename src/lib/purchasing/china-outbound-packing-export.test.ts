import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  type ChinaOutboundPackingExportDetail,
  exportChinaOutboundPackingWorkbook,
} from './china-outbound-packing-export'

describe('exportChinaOutboundPackingWorkbook', () => {
  it('keeps product, box, pallet, and unassigned packing rows in separate sheets', async () => {
    const detail: ChinaOutboundPackingExportDetail = {
      shipment: {
        shipmentNo: 'CHN-20260922-001',
        status: 'packing',
        originWarehouseCode: '중국창고A',
        destinationName: '한국창고',
        plannedOutboundDate: '2026-09-22',
        createdAt: '2026-09-22T00:00:00.000Z',
      },
      items: [
        { id: 'item-a', warehouseCode: '중국창고A', sku: '100001-0001', productName: '상품 A', optionName: '블랙', reservedQuantity: 100, packedQuantity: 70 },
        { id: 'item-b', warehouseCode: '중국창고A', sku: '100002-0001', productName: '상품 B', optionName: null, reservedQuantity: 50, packedQuantity: 35 },
        { id: 'item-c', warehouseCode: '중국창고A', sku: '100003-0001', productName: '상품 C', optionName: null, reservedQuantity: 5, packedQuantity: 0 },
      ],
      pallets: [
        { id: 'pallet-1', palletNo: '파렛트 1' },
        { id: 'pallet-2', palletNo: '파렛트 2' },
      ],
      boxes: [
        { id: 'box-1', palletId: 'pallet-1', boxNo: '박스 1', status: 'open' },
        { id: 'box-2', palletId: 'pallet-1', boxNo: '박스 2', status: 'open' },
        { id: 'box-3', palletId: null, boxNo: '박스 3', status: 'open' },
      ],
      boxItems: [
        { id: 'box-item-1', boxId: 'box-1', shipmentItemId: 'item-a', quantity: 60 },
        { id: 'box-item-2', boxId: 'box-2', shipmentItemId: 'item-a', quantity: 10 },
        { id: 'box-item-3', boxId: 'box-2', shipmentItemId: 'item-b', quantity: 30 },
        { id: 'box-item-4', boxId: 'box-3', shipmentItemId: 'item-b', quantity: 5 },
      ],
    }

    const buffer = await exportChinaOutboundPackingWorkbook(detail)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '요약',
      '상품별 분할',
      '박스별 적재',
      '파렛트별 적재',
      '파렛트 미지정',
    ])
    expect(workbook.getWorksheet('요약')?.getCell('B2').value).toBe('CHN-20260922-001')
    expect(workbook.getWorksheet('상품별 분할')?.rowCount).toBe(6)
    expect(workbook.getWorksheet('박스별 적재')?.rowCount).toBe(5)
    expect(workbook.getWorksheet('파렛트별 적재')?.rowCount).toBe(5)
    expect(workbook.getWorksheet('파렛트 미지정')?.getCell('G2').value).toBe(5)
  })
})
