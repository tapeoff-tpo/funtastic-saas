import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  type ChinaOutboundShipmentLabelDetail,
  chinaOutboundShipmentBoxLabelFilename,
  chinaOutboundShipmentBulkLabelFilename,
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
    { id: 'item-a', warehouseCode: '중국창고A', sku: '100001-0001', productName: '상품 A', optionName: '블랙', reservedQuantity: 100, packedQuantity: 100, location: 'A-01-03' },
    { id: 'item-b', warehouseCode: '중국창고A', sku: '100002-0001', productName: '상품 B', optionName: '화이트', reservedQuantity: 95, packedQuantity: 95, location: null },
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
      '박스 쉽먼트(装箱标签) 01',
      '박스 쉽먼트(装箱标签) 02',
      '박스 쉽먼트(装箱标签) 03',
      '박스 쉽먼트(装箱标签) 04',
      '파렛트 쉽먼트(托盘标签) 01',
      '파렛트 쉽먼트(托盘标签) 02',
    ])

    const boxSheet = workbook.getWorksheet('박스 쉽먼트(装箱标签) 01')!
    expect(boxSheet.getCell('A1').value).toBe('TAPEOFF')
    expect(boxSheet.getCell('A2').value ?? '').toBe('')
    expect(boxSheet.getCell('D2').value).toBe(60)
    expect(boxSheet.getCell('D2').numFmt).toBe('#,##0" PC"')
    expect(boxSheet.getCell('F2').value).toBe('不退')
    expect(cellText(boxSheet.getCell('A3'))).toContain('상품 A (블랙)')
    expect(cellText(boxSheet.getCell('A3'))).not.toContain('로케이션')
    expect(cellText(boxSheet.getCell('D8'))).toBe('로케이션 / 库位:\nA-01-03')
    expect(boxSheet.getCell('D5').value).toBe(5)
    expect(cellText(boxSheet.getCell('A8'))).toBe('박스번호 / 箱子号: 박스 1')
    expect(fillColor(boxSheet.getCell('A2'))).toBe('FFCFE8D0')
    expect(boxSheet.pageSetup.printArea).toBe('A1:F9')
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 04')!.getCell('A1').value).toBe('TAPEOFF')
    expect(boxSheet.pageSetup.orientation).toBe('landscape')
    expect(boxSheet.pageSetup.paperSize).toBe(9)
    expect(boxSheet.pageSetup.fitToWidth).toBe(1)
    expect(boxSheet.pageSetup.fitToHeight).toBe(1)

    const palletSheet = workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!
    expect(palletSheet.getCell('A1').value).toBe('TAPEOFF (파렛트 1)')
    expect(palletSheet.getCell('A1').font.size).toBeGreaterThanOrEqual(48)
    expect(palletSheet.getCell('F1').value).toBe('출고일 / 出库日期\n2026-10-15')
    expect(palletSheet.getCell('A2').value).toBe('번호\n序号')
    expect(palletSheet.getCell('E2').value).toBe('품명 / 品名')
    expect(palletSheet.getCell('A3').value).toBe(1)
    expect(palletSheet.getCell('B3').value).toBe('100001-0001')
    expect(palletSheet.getCell('C3').value).toBe(2)
    expect(palletSheet.getCell('D3').value).toBe('A-01-03')
    expect(palletSheet.getCell('E3').value).toBe('상품 A')
    expect(palletSheet.getCell('F3').value).toBe('블랙')
    expect(palletSheet.getCell('G3').value).toBe(100)
    expect(palletSheet.getCell('C4').value).toBe(1)
    expect(palletSheet.getCell('E4').value).toBe('상품 B')
    expect(palletSheet.getCell('D4').value).toBeNull()
    expect(palletSheet.getCell('G4').value).toBe(5)
    expect(palletSheet.getCell('A9').value).toBe(7)
    expect(palletSheet.getCell('G9').value).toBeNull()
    expect(palletSheet.pageSetup.printArea).toBe('A1:G9')
    expect(palletSheet.pageSetup).toMatchObject({ paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 1 })
    expect(Array.from({ length: 9 }, (_, index) => palletSheet.getRow(index + 1).height ?? 0).reduce((total, height) => total + height, 0)).toBeCloseTo(540)
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 02')!.getCell('A1').value).toBe('TAPEOFF (파렛트 2)')
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 03')).toBeUndefined()

    expect(workbook.getWorksheet('인쇄 안내')).toBeUndefined()
    expect(boxSheet.rowCount).toBe(9)
    expect(palletSheet.rowCount).toBe(9)
    expect(palletSheet.getCell('A2').value).toBe('번호\n序号')

    boxSheet.getCell('A2').value = '中文商品名'
    boxSheet.getCell('D8').value = '로케이션 / 库位: 수정된 위치'
    palletSheet.getCell('D3').value = '수정된 위치'
    palletSheet.getCell('E3').value = '中文商品名'
    const edited = new ExcelJS.Workbook()
    await edited.xlsx.load(await workbook.xlsx.writeBuffer())
    expect(edited.getWorksheet('박스 쉽먼트(装箱标签) 01')!.getCell('A2').value).toBe('中文商品名')
    expect(cellText(edited.getWorksheet('박스 쉽먼트(装箱标签) 01')!.getCell('D8'))).toContain('수정된 위치')
    expect(edited.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!.getCell('D3').value).toBe('수정된 위치')
    expect(edited.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!.getCell('E3').value).toBe('中文商品名')
  })

  it('keeps different SKUs separate even when their names, options or locations match', async () => {
    const matchingNameDetail: ChinaOutboundShipmentLabelDetail = {
      ...detail,
      items: [
        { ...detail.items[0], id: 'same-a', sku: 'SKU-A', productName: '동일 상품', optionName: '블랙', location: 'A-01' },
        { ...detail.items[0], id: 'same-a-other-warehouse', warehouseCode: '중국창고B', sku: ' SKU-A ', productName: '동일 상품', optionName: '블랙', location: 'A-01' },
        { ...detail.items[1], id: 'same-b', sku: 'SKU-B', productName: '동일 상품', optionName: '블랙', location: 'B-02' },
        { ...detail.items[1], id: 'missing', sku: 'SKU-C', productName: '동일 상품', optionName: '블랙', location: null },
        { ...detail.items[1], id: 'same-location', sku: 'SKU-D', productName: '동일 상품', optionName: '블랙', location: 'A-01' },
      ],
      boxItems: [
        { id: 'a1', boxId: 'box-1', shipmentItemId: 'same-a', quantity: 2 },
        { id: 'a2', boxId: 'box-1', shipmentItemId: 'same-a-other-warehouse', quantity: 1 },
        { id: 'b1', boxId: 'box-1', shipmentItemId: 'same-b', quantity: 3 },
        { id: 'c1', boxId: 'box-1', shipmentItemId: 'missing', quantity: 4 },
        { id: 'd1', boxId: 'box-1', shipmentItemId: 'same-location', quantity: 8 },
        { id: 'a3', boxId: 'box-2', shipmentItemId: 'same-a-other-warehouse', quantity: 5 },
        { id: 'b2', boxId: 'box-2', shipmentItemId: 'same-b', quantity: 6 },
      ],
    }

    const buffer = await exportChinaOutboundShipmentLabelWorkbook(matchingNameDetail)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    const box = workbook.getWorksheet('박스 쉽먼트(装箱标签) 01')!
    expect([2, 5, 8, 11].map((row) => box.getCell(`D${row}`).value)).toEqual([3, 3, 4, 8])
    expect([3, 6, 9, 12].map((row) => cellText(box.getCell(`A${row}`)))).toEqual([
      '한국어 상품명 / 韩文名称: 동일 상품 (블랙)',
      '한국어 상품명 / 韩文名称: 동일 상품 (블랙)',
      '한국어 상품명 / 韩文名称: 동일 상품 (블랙)',
      '한국어 상품명 / 韩文名称: 동일 상품 (블랙)',
    ])

    expect(cellText(box.getCell('D14'))).toContain('SKU-A: A-01')
    expect(cellText(box.getCell('D14'))).toContain('SKU-B: B-02')

    const pallet = workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!
    expect([3, 4, 5, 6].map((row) => [pallet.getCell(`B${row}`).value, pallet.getCell(`C${row}`).value, pallet.getCell(`D${row}`).value ?? '', pallet.getCell(`G${row}`).value]))
      .toEqual([['SKU-A', 2, 'A-01', 8], ['SKU-B', 2, 'B-02', 9], ['SKU-C', 1, '', 4], ['SKU-D', 1, 'A-01', 8]])
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 03')).toBeUndefined()
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 02')).toBeUndefined()
  })

  it.each(['boxes', 'pallets'] as const)('exports only %s sheets in a separate bulk workbook', async (type) => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await exportChinaOutboundShipmentLabelWorkbook(detail, {
      includeBoxLabels: type === 'boxes',
      includePalletLabels: type === 'pallets',
    }))
    const prefix = type === 'boxes' ? '박스 쉽먼트' : '파렛트 쉽먼트'
    expect(workbook.worksheets).toHaveLength(type === 'boxes' ? 4 : 2)
    expect(workbook.worksheets.every((sheet) => sheet.name.startsWith(prefix))).toBe(true)
    expect(workbook.worksheets[0].getCell('A1').value).toBe(type === 'boxes' ? 'TAPEOFF' : 'TAPEOFF (파렛트 1)')
    expect(chinaOutboundShipmentBulkLabelFilename('CN:10/15', type, new Date('2026-10-15T00:00:00.000Z')))
      .toBe(`CN_10_15_${type === 'boxes' ? '박스쉽먼트' : '파렛트쉽먼트'}_20261015.xlsx`)
  })

  it('keeps every product when a pallet has more than seven rows and leaves an unknown outbound date blank', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ ...detail.items[0], id: `item-${index}`, sku: `SKU-${String(index).padStart(2, '0')}` }))
    const boxes = items.map((item, index) => ({ ...detail.boxes[0], id: `box-${index}` }))
    const boxItems = items.map((item, index) => ({ id: `allocation-${index}`, boxId: boxes[index].id, shipmentItemId: item.id, quantity: index + 1 }))
    const buffer = await exportChinaOutboundShipmentLabelWorkbook({
      ...detail, shipment: { ...detail.shipment, plannedOutboundDate: null }, pallets: [{ ...detail.pallets[0], palletNo: 'P-42' }], items, boxes, boxItems,
    }, { includeBoxLabels: false })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const sheet = workbook.worksheets[0]
    expect(sheet.getCell('A1').value).toBe('TAPEOFF (P-42)')
    expect(sheet.getCell('F1').value).toBe('출고일 / 出库日期\n')
    expect(sheet.pageSetup.printArea).toBe('A1:G14')
    expect(sheet.getCell('A14').value).toBe(12)
    expect(sheet.getCell('B14').value).toBe('SKU-11')
    expect(Array.from({ length: 12 }, (_, index) => sheet.getCell(index + 3, 7).value as number).reduce((sum, quantity) => sum + quantity, 0)).toBe(78)
  })

  it('omits Chinese product names only from pallets and uses consistent font sizes across pallet sheets', async () => {
    const buffer = await exportChinaOutboundShipmentLabelWorkbook({
      ...detail,
      items: detail.items.map((item) => ({ ...item, chineseProductName: '中文商品名' })),
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 01')!.getCell('A2').value).toBe('中文商品名')
    const sizes = new Set<number | undefined>()
    const titleSizes = new Set<number | undefined>()
    for (const sheet of workbook.worksheets.filter((sheet) => sheet.name.startsWith('파렛트'))) {
      expect(sheet.getCell('E3').value).toBe(sheet.name.endsWith('01') ? '상품 A' : '상품 B')
      titleSizes.add(sheet.getCell('A1').font.size)
      for (let column = 1; column <= 7; column += 1) {
        expect(sheet.getCell(2, column).font.size).toBe(16)
        for (let row = 3; row <= sheet.rowCount; row += 1) sizes.add(sheet.getCell(row, column).font.size)
      }
    }
    expect(sizes.size).toBe(1)
    expect(titleSizes.size).toBe(1)
    expect([...sizes][0]).toBeGreaterThanOrEqual(18)
  })

  it('creates a Windows-safe attachment filename', () => {
    expect(chinaOutboundShipmentLabelFilename('CN:10/15', new Date('2026-10-15T00:00:00.000Z')))
      .toBe('CN_10_15_부착용쉽먼트_20261015.xlsx')
    expect(chinaOutboundShipmentBoxLabelFilename('CN:10/15', '박스? 1', new Date('2026-10-15T00:00:00.000Z')))
      .toBe('CN_10_15_박스_ 1_부착용쉽먼트_20261015.xlsx')
  })

  it('creates only the selected saved box labels without pallet labels', async () => {
    const buffer = await exportChinaOutboundShipmentLabelWorkbook(detail, {
      boxIds: ['box-2', 'box-4'],
      includePalletLabels: false,
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '박스 쉽먼트(装箱标签) 01',
      '박스 쉽먼트(装箱标签) 02',
    ])
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 01')!.getCell('A1').value).toBe('TAPEOFF')
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 02')!.getCell('A1').value).toBe('TAPEOFF')
    const singleBox = workbook.getWorksheet('박스 쉽먼트(装箱标签) 01')!
    expect(singleBox.pageSetup.printArea).toBe('A1:F6')
    expect(singleBox.rowCount).toBe(6)
    expect(singleBox.getCell('A1').font.size).toBe(60)
    expect(singleBox.getCell('D2').font.size).toBe(40)
    expect(singleBox.getCell('D2').value).toBe(40)
    expect(cellText(singleBox.getCell('A5'))).toBe('박스번호 / 箱子号: 박스 2')
    expect([1, 2, 3, 4, 5, 6].reduce((height, row) => height + singleBox.getRow(row).height, 0)).toBe(540)
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')).toBeUndefined()
  })

  it('creates labels for saved boxes before every shipment item is fully packed', async () => {
    const partialDetail: ChinaOutboundShipmentLabelDetail = {
      ...detail,
      items: [
        { ...detail.items[0], packedQuantity: 100 },
        { ...detail.items[1], packedQuantity: 20 },
      ],
      boxItems: [
        { id: 'partial-box-item-1', boxId: 'box-1', shipmentItemId: 'item-a', quantity: 50 },
        { id: 'partial-box-item-2', boxId: 'box-2', shipmentItemId: 'item-a', quantity: 50 },
        { id: 'partial-box-item-3', boxId: 'box-1', shipmentItemId: 'item-b', quantity: 20 },
      ],
    }

    const buffer = await exportChinaOutboundShipmentLabelWorkbook(partialDetail)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '박스 쉽먼트(装箱标签) 01',
      '박스 쉽먼트(装箱标签) 02',
      '파렛트 쉽먼트(托盘标签) 01',
    ])
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 01')!.getCell('A1').value).toBe('TAPEOFF')
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 02')!.getCell('A1').value).toBe('TAPEOFF')
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 03')).toBeUndefined()
    expect(cellText(workbook.getWorksheet('박스 쉽먼트(装箱标签) 01')!.getCell('D8'))).toContain('A-01-03')
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!.getCell('C3').value).toBe(2)
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!.getCell('D3').value).toBe('A-01-03')
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!.getCell('G3').value).toBe(100)
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!.getCell('G4').value).toBe(20)
  })
})

function fillColor(cell: ExcelJS.Cell) {
  return cell.fill.type === 'pattern' ? cell.fill.fgColor?.argb : undefined
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value
  return value && typeof value === 'object' && 'richText' in value
    ? value.richText.map((run) => run.text).join('') : String(value ?? '')
}
