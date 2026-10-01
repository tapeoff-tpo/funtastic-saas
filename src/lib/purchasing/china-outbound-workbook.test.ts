import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  CHINA_OUTBOUND_WORKBOOK_SHEETS,
  type ChinaOutboundWorkbookDetail,
  exportChinaOutboundWorkWorkbook,
  parseChinaOutboundWorkWorkbook,
} from './china-outbound-workbook'

const detail: ChinaOutboundWorkbookDetail = {
  shipment: {
    shipmentNo: 'CN-20261001-TEST',
    displayName: '10월 1일 중국출고',
    status: 'packing',
    destinationName: '한국 1창고',
    plannedOutboundDate: '2026-10-01',
  },
  items: [
    { id: 'item-a', warehouseCode: '중국창고A', sku: '100001-0001', productName: '상품 A', optionName: '블랙', reservedQuantity: 100, packedQuantity: 0 },
    { id: 'item-b', warehouseCode: '중국창고B', sku: '100002-0001', productName: '상품 B', optionName: null, reservedQuantity: 50, packedQuantity: 0 },
  ],
  pallets: [],
  boxes: [],
  boxItems: [],
}

describe('China outbound work workbook', () => {
  it('exports the four work sheets and imports a box split before a pallet assignment', async () => {
    const buffer = await exportChinaOutboundWorkWorkbook(detail)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      CHINA_OUTBOUND_WORKBOOK_SHEETS.guide,
      CHINA_OUTBOUND_WORKBOOK_SHEETS.items,
      CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits,
      CHINA_OUTBOUND_WORKBOOK_SHEETS.palletLoads,
    ])

    const splitSheet = workbook.getWorksheet(CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits)!
    splitSheet.getCell('G2').value = 'A-01'
    splitSheet.getCell('H2').value = 60
    splitSheet.getCell('I2').value = 50
    splitSheet.getCell('J2').value = 40
    splitSheet.getCell('K2').value = 30
    splitSheet.addRow(['item-a', '100001-0001', '상품 A', '블랙', '중국창고A', 100, 'A-02', 40, 50, 40, 30])
    splitSheet.getCell('G3').value = 'B-01'
    splitSheet.getCell('H3').value = 50
    splitSheet.getCell('I3').value = 60
    splitSheet.getCell('J3').value = 50
    splitSheet.getCell('K3').value = 40

    const palletSheet = workbook.getWorksheet(CHINA_OUTBOUND_WORKBOOK_SHEETS.palletLoads)!
    palletSheet.addRow(['A-01', '1'])
    palletSheet.addRow(['A-02', '1'])
    palletSheet.addRow(['B-01', '2'])

    const parsed = await parseChinaOutboundWorkWorkbook({
      fileBuffer: await workbook.xlsx.writeBuffer(),
      detail,
    })

    expect(parsed.errors).toEqual([])
    expect(parsed.boxSplits).toEqual([
      {
        shipmentItemId: 'item-a',
        allocations: [
          { boxNo: 'A-01', quantity: 60, lengthCm: 50, widthCm: 40, heightCm: 30 },
          { boxNo: 'A-02', quantity: 40, lengthCm: 50, widthCm: 40, heightCm: 30 },
        ],
      },
      {
        shipmentItemId: 'item-b',
        allocations: [{ boxNo: 'B-01', quantity: 50, lengthCm: 60, widthCm: 50, heightCm: 40 }],
      },
    ])
    expect(parsed.palletAssignments).toEqual([
      { boxNo: 'A-01', palletNo: '1' },
      { boxNo: 'A-02', palletNo: '1' },
      { boxNo: 'B-01', palletNo: '2' },
    ])
  })

  it('flags a box split that exceeds the outbound quantity', async () => {
    const workbook = new ExcelJS.Workbook()
    const splitSheet = workbook.addWorksheet(CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits)
    splitSheet.addRow(['출고상품ID', '품목코드', '상품명', '옵션명', '출고창고', '출고수량', '박스번호', '박스 적재수량', '가로(cm)', '세로(cm)', '높이(cm)', 'CBM', '진행상태'])
    splitSheet.addRow(['item-a', '100001-0001', '상품 A', '블랙', '중국창고A', 100, 'A-01', 101, 50, 40, 30])
    const palletSheet = workbook.addWorksheet(CHINA_OUTBOUND_WORKBOOK_SHEETS.palletLoads)
    palletSheet.addRow(['박스번호', '파렛트번호', '박스 적재수량', '가로(cm)', '세로(cm)', '높이(cm)', 'CBM', '적재상품'])
    palletSheet.addRow(['A-01', '1'])

    const parsed = await parseChinaOutboundWorkWorkbook({
      fileBuffer: await workbook.xlsx.writeBuffer(),
      detail,
    })

    expect(parsed.errors.some((error) => error.message.includes('출고수량 100개를 넘습니다'))).toBe(true)
  })
})
