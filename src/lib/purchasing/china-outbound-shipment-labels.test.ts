import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  type ChinaOutboundShipmentLabelDetail,
  chinaOutboundShipmentBoxLabelFilename,
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
    expect(cellText(boxSheet.getCell('A3'))).toContain('로케이션 / 库位: A-01-03')
    expect(boxSheet.getCell('D5').value).toBe(5)
    expect(boxSheet.getCell('D8').value).toBe('박스 1')
    expect(fillColor(boxSheet.getCell('A2'))).toBe('FFCFE8D0')
    expect(boxSheet.pageSetup.printArea).toBe('A1:F9')
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 04')!.getCell('A1').value).toBe('TAPEOFF')
    expect(boxSheet.pageSetup.orientation).toBe('landscape')
    expect(boxSheet.pageSetup.paperSize).toBe(9)
    expect(boxSheet.pageSetup.fitToWidth).toBe(1)
    expect(boxSheet.pageSetup.fitToHeight).toBe(1)

    const palletSheet = workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!
    expect(palletSheet.getCell('A1').value).toBe('TAPEOFF')
    expect(palletSheet.getCell('A2').value).toBe('파렛트번호 / 托盘号')
    expect(palletSheet.getCell('D2').value).toBe('상품명(한국어) / 商品名称（韩文）')
    expect(palletSheet.getCell('E2').value).toBe('상품명(중국어) / 商品名称（中文）')
    expect(palletSheet.getCell('A3').value).toBe('파렛트 1')
    expect(palletSheet.getCell('B3').value).toBe(2)
    expect(fillColor(palletSheet.getCell('C3'))).toBe('FFFFF2CC')
    expect(palletSheet.getCell('C3').value).toBe('A-01-03')
    expect(palletSheet.getCell('D3').value).toBe('상품 A')
    expect(palletSheet.getCell('E3').value ?? '').toBe('')
    expect(fillColor(palletSheet.getCell('E3'))).toBe('FFFFF2CC')
    expect(palletSheet.getCell('F3').value).toBe('블랙')
    expect(palletSheet.getCell('G3').value).toBe(100)
    expect(palletSheet.getCell('D4').value).toBe('상품 B')
    expect(palletSheet.getCell('C4').value ?? '').toBe('')
    expect(palletSheet.getCell('G4').value).toBe(5)
    expect(palletSheet.pageSetup.printArea).toBe('A1:G4')
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 02')!.getCell('A1').value).toBe('TAPEOFF')
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 03')).toBeUndefined()

    expect(workbook.getWorksheet('인쇄 안내')).toBeUndefined()
    expect(boxSheet.rowCount).toBe(9)
    expect(palletSheet.rowCount).toBe(4)
    expect(palletSheet.getCell('A2').value).toBe('파렛트번호 / 托盘号')

    boxSheet.getCell('A2').value = '中文商品名'
    boxSheet.getCell('A3').value = '한국어 상품명 / 韩文名称: 상품 A (블랙)\n로케이션 / 库位: 수정된 위치'
    palletSheet.getCell('C3').value = '수정된 위치'
    palletSheet.getCell('E3').value = '中文商品名'
    const edited = new ExcelJS.Workbook()
    await edited.xlsx.load(await workbook.xlsx.writeBuffer())
    expect(edited.getWorksheet('박스 쉽먼트(装箱标签) 01')!.getCell('A2').value).toBe('中文商品名')
    expect(cellText(edited.getWorksheet('박스 쉽먼트(装箱标签) 01')!.getCell('A3'))).toContain('수정된 위치')
    expect(edited.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!.getCell('C3').value).toBe('수정된 위치')
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
      '한국어 상품명 / 韩文名称: 동일 상품 (블랙)\n로케이션 / 库位: A-01',
      '한국어 상품명 / 韩文名称: 동일 상품 (블랙)\n로케이션 / 库位: B-02',
      '한국어 상품명 / 韩文名称: 동일 상품 (블랙)',
      '한국어 상품명 / 韩文名称: 동일 상품 (블랙)\n로케이션 / 库位: A-01',
    ])

    const pallet = workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!
    expect([3, 4, 5, 6].map((row) => [pallet.getCell(`B${row}`).value, pallet.getCell(`C${row}`).value ?? '', pallet.getCell(`G${row}`).value]))
      .toEqual([[2, 'A-01', 8], [2, 'B-02', 9], [2, '', 4], [2, 'A-01', 8]])
    expect(workbook.getWorksheet('박스 쉽먼트(装箱标签) 03')).toBeUndefined()
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 02')).toBeUndefined()
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
    expect(singleBox.getCell('D5').value).toBe('박스 2')
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
    expect(cellText(workbook.getWorksheet('박스 쉽먼트(装箱标签) 01')!.getCell('A3'))).toContain('A-01-03')
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!.getCell('B3').value).toBe(2)
    expect(workbook.getWorksheet('파렛트 쉽먼트(托盘标签) 01')!.getCell('C3').value).toBe('A-01-03')
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
