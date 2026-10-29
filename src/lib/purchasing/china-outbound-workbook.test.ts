import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  CHINA_OUTBOUND_REGISTRATION_BOX_DISPLAY_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_ITEM_DISPLAY_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_SHIPMENT_DISPLAY_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_SHEET,
  CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS,
} from './china-outbound-registration-workbook'
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

async function loadWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  return workbook
}

function rowCellValues(sheet: ExcelJS.Worksheet, rowNumber: number, columnCount: number) {
  return Array.from({ length: columnCount }, (_, index) => sheet.getRow(rowNumber).getCell(index + 1).value)
}

describe('China outbound work workbook', () => {
  it('uses the same bilingual registration layout and pre-fills the selected outbound items', async () => {
    const buffer = await exportChinaOutboundWorkWorkbook(detail, {
      warehouseCodes: ['중국창고A'],
      currentInventory: [
        {
          warehouseCode: '중국창고A',
          sku: '100001-0001',
          productName: '상품 A',
          optionName: '블랙',
          itemCategory: '상품',
          onHandQuantity: 300,
          reservedQuantity: 100,
          availableQuantity: 200,
          lastReceivedAt: '2026-09-30',
          lastOutboundAt: null,
        },
      ],
    })
    const workbook = await loadWorkbook(buffer)

    expect(rowCellValues(workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!, 1, 6))
      .toEqual(CHINA_OUTBOUND_REGISTRATION_SHIPMENT_DISPLAY_HEADERS)
    expect(rowCellValues(workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!, 1, 5))
      .toEqual(CHINA_OUTBOUND_REGISTRATION_ITEM_DISPLAY_HEADERS)
    expect(rowCellValues(workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!, 1, 11))
      .toEqual(CHINA_OUTBOUND_REGISTRATION_BOX_DISPLAY_HEADERS)
    expect(workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.inventory)?.getCell('A2').value).toBe('중국창고A')

    const shipmentSheet = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
    expect(rowCellValues(shipmentSheet, 2, 6)).toEqual([
      'CN-20261001-TEST',
      '10월 1일 중국출고',
      '한국 1창고',
      '',
      '2026-10-01',
      '',
    ])

    const itemSheet = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
    expect(rowCellValues(itemSheet, 2, 5)).toEqual(['중국창고A', '100001-0001', '상품 A', '블랙', 100])
    expect(rowCellValues(itemSheet, 3, 5)).toEqual(['중국창고B', '100002-0001', '상품 B', '', 50])

    const boxSheet = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!
    expect(rowCellValues(boxSheet, 2, 11)).toEqual(['중국창고A', '100001-0001', '상품 A', '블랙', 100, '', '', '', '', '', ''])
    expect(rowCellValues(boxSheet, 3, 11)).toEqual(['중국창고B', '100002-0001', '상품 B', '', 50, '', '', '', '', '', ''])
    expect(workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_SHEET)?.getColumn(1).values).toEqual([
      undefined,
      '중국창고A',
      '중국창고B',
    ])

    boxSheet.getCell('F2').value = 'A-01'
    boxSheet.getCell('G2').value = 60
    boxSheet.getCell('H2').value = 50
    boxSheet.getCell('I2').value = 40
    boxSheet.getCell('J2').value = 30
    boxSheet.getCell('K2').value = '1'
    boxSheet.addRow(['중국창고A', '100001-0001', '상품 A', '블랙', 100, 'A-02', 40, 50, 40, 30, '1'])
    boxSheet.getCell('F3').value = 'B-01'
    boxSheet.getCell('G3').value = 50
    boxSheet.getCell('H3').value = 60
    boxSheet.getCell('I3').value = 50
    boxSheet.getCell('J3').value = 40
    boxSheet.getCell('K3').value = '2'

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

  it.each([false, true])('round-trips saved boxes and pallets (legacy columns: %s)', async (legacy) => {
    const packedDetail: ChinaOutboundWorkbookDetail = {
      ...detail,
      pallets: [{ id: 'pallet-1', palletNo: 'PALLET-1' }],
      boxes: [{ id: 'box-1', palletId: 'pallet-1', boxNo: 'BOX-01', lengthCm: 50, widthCm: 40, heightCm: 30 }],
      boxItems: [{ id: 'allocation-1', boxId: 'box-1', shipmentItemId: 'item-a', quantity: 60 }],
    }
    const workbook = await loadWorkbook(await exportChinaOutboundWorkWorkbook(packedDetail))
    const boxes = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!
    expect(rowCellValues(boxes, 2, 11)).toEqual([
      '중국창고A', '100001-0001', '상품 A', '블랙', 100, 'BOX-01', 60, 50, 40, 30, 'PALLET-1',
    ])
    expect(boxes.getCell('C3').value).toBe('상품 B')
    expect(boxes.rowCount).toBe(3)
    if (legacy) {
      boxes.spliceColumns(5, 1)
      boxes.spliceColumns(3, 1)
      workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!.spliceColumns(3, 1)
    }
    const parsed = await parseChinaOutboundWorkWorkbook({
      fileBuffer: await workbook.xlsx.writeBuffer(),
      detail: packedDetail,
    })
    expect(parsed.errors).toEqual([])
    expect(parsed.boxSplits).toEqual([{
      shipmentItemId: 'item-a',
      allocations: [{ boxNo: 'BOX-01', quantity: 60, lengthCm: 50, widthCm: 40, heightCm: 30 }],
    }, { shipmentItemId: 'item-b', allocations: [] }])
    expect(parsed.palletAssignments).toEqual([{ boxNo: 'BOX-01', palletNo: 'PALLET-1' }])
  })

  it.each([{ total: 100, perBox: 20 }, { total: 200, perBox: 40 }])('keeps five box rows and the $total-unit reference total after import', async ({ total, perBox }) => {
    const selection: ChinaOutboundWorkbookDetail = {
      ...detail,
      items: [{ ...detail.items[0], reservedQuantity: total }],
    }
    const workbook = await loadWorkbook(await exportChinaOutboundWorkWorkbook(selection))
    const boxes = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!
    boxes.spliceRows(2, 1, ...Array.from({ length: 5 }, (_, index) => [
      '중국창고A', '100001-0001', '상품 A', '블랙', total, `BOX-${index + 1}`, perBox, '', '', '', '',
    ]))
    const imported = await parseChinaOutboundWorkWorkbook({
      fileBuffer: await workbook.xlsx.writeBuffer(), detail: selection,
    })
    expect(imported.errors).toEqual([])
    expect(imported.boxSplits[0].allocations).toHaveLength(5)

    const saved: ChinaOutboundWorkbookDetail = {
      ...selection,
      boxes: imported.boxSplits[0].allocations.map((box) => ({
        id: box.boxNo, boxNo: box.boxNo, palletId: null,
      })),
      boxItems: imported.boxSplits[0].allocations.map((box) => ({
        id: box.boxNo, boxId: box.boxNo, shipmentItemId: 'item-a', quantity: box.quantity,
      })),
    }
    for (let download = 0; download < 2; download += 1) {
      const exported = await loadWorkbook(await exportChinaOutboundWorkWorkbook(saved))
      const sheet = exported.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!
      expect([2, 3, 4, 5, 6].map((row) => sheet.getCell(`E${row}`).value)).toEqual([total, total, total, total, total])
      expect(sheet.rowCount).toBe(6) // Header plus the five saved boxes.
      expect([2, 3, 4, 5, 6].map((row) => sheet.getCell(`G${row}`).value)).toEqual([perBox, perBox, perBox, perBox, perBox])
      const parsed = await parseChinaOutboundWorkWorkbook({
        fileBuffer: await exported.xlsx.writeBuffer(), detail: saved,
      })
      expect(parsed.errors).toEqual([])
      expect(parsed.boxSplits[0].allocations).toHaveLength(5)
    }
  })

  it('rejects changing the selected outbound item quantity in a shared work workbook', async () => {
    const workbook = await loadWorkbook(await exportChinaOutboundWorkWorkbook(detail))
    const itemSheet = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
    itemSheet.getCell('E2').value = 99

    const parsed = await parseChinaOutboundWorkWorkbook({
      fileBuffer: await workbook.xlsx.writeBuffer(),
      detail,
    })

    expect(parsed.errors.some((error) => error.sheet === CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items && error.row === 2)).toBe(true)
  })

  it('continues to import a legacy work workbook', async () => {
    const workbook = new ExcelJS.Workbook()
    const splitSheet = workbook.addWorksheet(CHINA_OUTBOUND_WORKBOOK_SHEETS.boxSplits)
    splitSheet.addRow(['출고상품ID', '품목코드', '상품명', '옵션명', '출고창고', '출고수량', '박스번호', '박스 적재수량', '가로(cm)', '세로(cm)', '높이(cm)', 'CBM', '진행상태'])
    splitSheet.addRow(['item-a', '100001-0001', '상품 A', '블랙', '중국창고A', 100, 'A-01', 60, 50, 40, 30])
    splitSheet.addRow(['item-a', '100001-0001', '상품 A', '블랙', '중국창고A', 100, 'A-02', 40, 50, 40, 30])
    splitSheet.addRow(['item-b', '100002-0001', '상품 B', '', '중국창고B', 50, 'B-01', 50, 60, 50, 40])
    const palletSheet = workbook.addWorksheet(CHINA_OUTBOUND_WORKBOOK_SHEETS.palletLoads)
    palletSheet.addRow(['박스번호', '파렛트번호', '박스 적재수량', '가로(cm)', '세로(cm)', '높이(cm)', 'CBM', '적재상품'])
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

  it('flags a legacy box split that exceeds the outbound quantity', async () => {
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
