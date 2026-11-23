import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { type ChinaOutboundPackingExportDetail, exportChinaOutboundPackingWorkbook } from './china-outbound-packing-export'

function packingDetail(): ChinaOutboundPackingExportDetail {
  return {
    shipment: { shipmentNo: 'CHN-20260922-001', status: 'packing', originWarehouseCode: '중국창고', destinationName: '한국창고', plannedOutboundDate: '2026-09-22', createdAt: '2026-09-22T00:00:00.000Z' },
    items: [
      { id: 'item-a', warehouseCode: '중국창고', sku: '100001-0001', productName: '상품 A', optionName: '블랙', reservedQuantity: 100, packedQuantity: 80, location: 'A-01' },
      { id: 'item-b', warehouseCode: '대량창고', sku: '100002-0001', productName: '상품 B', optionName: null, reservedQuantity: 50, packedQuantity: 15 },
      { id: 'item-c', warehouseCode: '미입고창고', sku: '100003-0001', productName: '미포장 상품', optionName: null, reservedQuantity: 5, packedQuantity: 0 },
    ],
    pallets: [
      { id: 'pallet-1', palletNo: '파렛트 1', lengthCm: 120, widthCm: 100, heightCm: 150, grossWeightKg: 999, tareWeightKg: 7.125 },
      { id: 'pallet-2', palletNo: '빈 파렛트' },
    ],
    boxes: [
      { id: 'box-1', palletId: 'pallet-1', boxNo: '1', status: 'open', lengthCm: 50, widthCm: 40, heightCm: 30, grossWeightKg: 15 },
      { id: 'box-2', palletId: 'pallet-1', boxNo: '2', status: 'open', lengthCm: 10, widthCm: 20, heightCm: 30, grossWeightKg: 20 },
      { id: 'box-3', palletId: null, boxNo: '3', status: 'open', lengthCm: 10, widthCm: 10, heightCm: 10 },
      { id: 'empty-box', palletId: 'pallet-2', boxNo: '빈 박스', status: 'open', lengthCm: 100, widthCm: 100, heightCm: 100, grossWeightKg: 500 },
    ],
    boxItems: [
      { id: 'allocation-1', boxId: 'box-1', shipmentItemId: 'item-a', quantity: 60 },
      { id: 'allocation-2', boxId: 'box-2', shipmentItemId: 'item-a', quantity: 20 },
      { id: 'allocation-3', boxId: 'box-2', shipmentItemId: 'item-b', quantity: 10 },
      { id: 'allocation-4', boxId: 'box-3', shipmentItemId: 'item-b', quantity: 5 },
    ],
  }
}

async function exportWorkbook(detail = packingDetail()) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportChinaOutboundPackingWorkbook(detail) as unknown as ExcelJS.Buffer)
  return workbook
}

const headers = (sheet: ExcelJS.Worksheet) => Array.from({ length: sheet.columnCount }, (_, index) => sheet.getCell(1, index + 1).text)
const dataRows = (sheet: ExcelJS.Worksheet) => Array.from({ length: sheet.rowCount - 1 }, (_, index) => sheet.getRow(index + 2))
function cell(sheet: ExcelJS.Worksheet, row: ExcelJS.Row, header: string) {
  const column = headers(sheet).indexOf(header) + 1
  expect(column, `Missing ${header} column`).toBeGreaterThan(0)
  return row.getCell(column)
}
function productRow(sheet: ExcelJS.Worksheet, sku: string) {
  const row = dataRows(sheet).find((candidate) => cell(sheet, candidate, '상품코드').text === sku)
  expect(row, `Missing ${sku} row`).toBeDefined()
  return row!
}

const palletHeaders = ['파렛트', '파렛트박스수량', '박스번호', '상품코드', '상품명', '옵션', '입고수량', '중국창고', '대량창고', '창고구분', '무게(kg)', 'CBM', '로케이션']
const boxHeaders = ['박스번호', '박스수량', '상품코드', '상품명', '옵션명', '입고수량', '중국창고', '대량창고', '창고구분', '무게(kg)', 'CBM', '로케이션']

describe('exportChinaOutboundPackingWorkbook', () => {
  it('includes final totals alongside product detail while using the requested pallet and box column order', async () => {
    const workbook = await exportWorkbook()
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['상품별 분할', '최종 적재 요약', '박스별 적재', '파렛트별 적재', '파렛트 미지정'])
    expect(workbook.getWorksheet('상품별 분할')!.rowCount).toBe(6)
    expect(headers(workbook.getWorksheet('파렛트별 적재')!)).toEqual(palletHeaders)
    expect(headers(workbook.getWorksheet('박스별 적재')!)).toEqual(boxHeaders)
    expect(headers(workbook.getWorksheet('파렛트 미지정')!)).toEqual(boxHeaders)
  })

  it('counts distinct physical boxes for each pallet product and sums its receiving quantity', async () => {
    const sheet = (await exportWorkbook()).getWorksheet('파렛트별 적재')!
    expect(dataRows(sheet)).toHaveLength(2)
    const a = productRow(sheet, '100001-0001'), b = productRow(sheet, '100002-0001')
    expect(cell(sheet, a, '파렛트박스수량').value).toBe(2)
    expect(cell(sheet, a, '박스번호').value).toBe('1, 2')
    expect(cell(sheet, a, '입고수량').value).toBe(80)
    expect(cell(sheet, b, '파렛트박스수량').value).toBe(1)
    expect(cell(sheet, b, '박스번호').value).toBe('2')
    expect(cell(sheet, b, '입고수량').value).toBe(10)
    expect(cell(sheet, a, '로케이션').value).toBe('A-01')
    expect(cell(sheet, b, '로케이션').value).toBeNull()
  })

  it('exports manual box and pallet CBM while leaving unmeasured centimeter dimensions blank', async () => {
    const detail = packingDetail()
    detail.boxes[0] = { ...detail.boxes[0], lengthCm: null, widthCm: null, heightCm: null, manualCbm: 0.125 }
    detail.boxes[1] = { ...detail.boxes[1], manualCbm: 0.3 }
    detail.boxes[2] = { ...detail.boxes[2], lengthCm: null, widthCm: null, heightCm: null, manualCbm: 0.007 }
    detail.pallets[0] = { ...detail.pallets[0], lengthCm: null, widthCm: null, heightCm: null, manualCbm: 0.75 }
    const original = JSON.stringify(detail)
    const workbook = await exportWorkbook(detail)
    const products = workbook.getWorksheet('상품별 분할')!
    expect(products.getCell('K2').value).toBeNull()
    expect(products.getCell('L2').value).toBe(0.125)
    expect(products.getCell('K3').value).toBe('10 × 20 × 30 cm')
    expect(products.getCell('L3').value).toBe(0.3)
    const boxSheet = workbook.getWorksheet('박스별 적재')!
    expect(dataRows(boxSheet).map((row) => cell(boxSheet, row, 'CBM').value)).toEqual([0.125, 0.3, null, 0.007])
    const palletSheet = workbook.getWorksheet('파렛트별 적재')!
    expect(dataRows(palletSheet).map((row) => cell(palletSheet, row, 'CBM').value)).toEqual([0.75, null])
    const looseSheet = workbook.getWorksheet('파렛트 미지정')!
    expect(cell(looseSheet, dataRows(looseSheet)[0], 'CBM').value).toBe(0.007)
    expect(JSON.stringify(detail)).toBe(original)
  })

  it('combines same-product reservations across warehouses and counts their shared box only once', async () => {
    const detail = packingDetail()
    detail.items = [
      { ...detail.items[0], id: 'same-a', sku: ' SAME-SKU ', reservedQuantity: 6, packedQuantity: 6 },
      { ...detail.items[0], id: 'same-b', sku: 'SAME-SKU', warehouseCode: '대량창고', reservedQuantity: 4, packedQuantity: 4 },
    ]
    detail.boxItems = [
      { id: 'first', boxId: 'box-1', shipmentItemId: 'same-a', quantity: 2 },
      { id: 'second', boxId: 'box-1', shipmentItemId: 'same-a', quantity: 4 },
      { id: 'third', boxId: 'box-1', shipmentItemId: 'same-b', quantity: 4 },
    ]
    const workbook = await exportWorkbook(detail)
    for (const name of ['파렛트별 적재', '박스별 적재']) {
      const sheet = workbook.getWorksheet(name)!
      expect(dataRows(sheet)).toHaveLength(1)
      const row = productRow(sheet, 'SAME-SKU')
      expect(cell(sheet, row, name === '파렛트별 적재' ? '파렛트박스수량' : '박스수량').value).toBe(1)
      expect(cell(sheet, row, '입고수량').value).toBe(10)
      expect(cell(sheet, row, '중국창고').value).toBe(6)
      expect(cell(sheet, row, '대량창고').value).toBe(4)
      expect(cell(sheet, row, '창고구분').value).toBe('중국창고, 대량창고')
    }
  })

  it('prints measured package weight and CBM only once when a pallet or box contains several products', async () => {
    const workbook = await exportWorkbook()
    const palletSheet = workbook.getWorksheet('파렛트별 적재')!, palletRows = dataRows(palletSheet)
    expect(palletRows.map((row) => cell(palletSheet, row, '무게(kg)').value)).toEqual([42.125, null])
    expect(palletRows.map((row) => cell(palletSheet, row, 'CBM').value)).toEqual([1.8, null])
    expect(cell(palletSheet, palletRows[0], '무게(kg)').numFmt).toBe('#,##0.000')
    expect(cell(palletSheet, palletRows[0], 'CBM').numFmt).toBe('#,##0.0000')
    const boxSheet = workbook.getWorksheet('박스별 적재')!
    const mixedRows = dataRows(boxSheet).filter((row) => cell(boxSheet, row, '박스번호').text === '2')
    expect(mixedRows).toHaveLength(2)
    expect(mixedRows.map((row) => cell(boxSheet, row, '무게(kg)').value)).toEqual([20, null])
    expect(mixedRows.map((row) => cell(boxSheet, row, 'CBM').value)).toEqual([0.006, null])
    expect(dataRows(boxSheet).every((row) => cell(boxSheet, row, '박스수량').value === 1)).toBe(true)
  })

  it('uses only warehouses with packed incoming stock and excludes empty physical packages from the receiving lists', async () => {
    const workbook = await exportWorkbook()
    for (const name of ['파렛트별 적재', '박스별 적재', '파렛트 미지정']) {
      const sheet = workbook.getWorksheet(name)!
      expect(headers(sheet)).not.toContain('미입고창고')
      expect(dataRows(sheet).some((row) => row.values.toString().includes('빈 박스') || row.values.toString().includes('빈 파렛트'))).toBe(false)
      for (const row of dataRows(sheet)) expect((cell(sheet, row, '중국창고').value as number) + (cell(sheet, row, '대량창고').value as number)).toBe(cell(sheet, row, '입고수량').value)
    }
    const pallet = workbook.getWorksheet('파렛트별 적재')!
    expect(cell(pallet, productRow(pallet, '100001-0001'), '대량창고').value).toBe(0)
    const loose = workbook.getWorksheet('파렛트 미지정')!
    expect(dataRows(loose)).toHaveLength(1)
    expect(cell(loose, dataRows(loose)[0], '박스번호').value).toBe('3')
    expect(cell(loose, dataRows(loose)[0], '입고수량').value).toBe(5)
    expect(cell(loose, dataRows(loose)[0], '창고구분').value).toBe('대량창고')
  })

  it('keeps different options and locations separate and does not invent missing measurements', async () => {
    const detail = packingDetail()
    detail.items = [
      { ...detail.items[0], id: 'black', sku: 'SAME', reservedQuantity: 2, packedQuantity: 2, location: 'A-01' },
      { ...detail.items[0], id: 'white', sku: 'SAME', optionName: '화이트', reservedQuantity: 3, packedQuantity: 3, location: 'A-01' },
      { ...detail.items[0], id: 'different-location', sku: 'SAME', reservedQuantity: 4, packedQuantity: 4, location: 'B-02' },
    ]
    detail.boxes = [{ id: 'unmeasured', palletId: 'pallet-1', boxNo: '1', status: 'open' }]
    detail.pallets = [{ id: 'pallet-1', palletNo: 'P1' }]
    detail.boxItems = detail.items.map((item) => ({ id: `allocation-${item.id}`, boxId: 'unmeasured', shipmentItemId: item.id, quantity: item.reservedQuantity }))
    const workbook = await exportWorkbook(detail)
    for (const name of ['파렛트별 적재', '박스별 적재']) {
      const sheet = workbook.getWorksheet(name)!
      expect(dataRows(sheet)).toHaveLength(3)
      expect(dataRows(sheet).map((row) => [cell(sheet, row, name === '파렛트별 적재' ? '옵션' : '옵션명').value, cell(sheet, row, '로케이션').value, cell(sheet, row, '입고수량').value])).toEqual(expect.arrayContaining([
        ['블랙', 'A-01', 2], ['화이트', 'A-01', 3], ['블랙', 'B-02', 4],
      ]))
      expect(dataRows(sheet).every((row) => cell(sheet, row, '무게(kg)').value === null && cell(sheet, row, 'CBM').value === null)).toBe(true)
    }
  })
})

it('exports whole-pallet volume and loose boxes once with the final shipment weight', async () => {
  const detail = packingDetail()
  detail.boxes[2].grossWeightKg = 3
  const workbook = await exportWorkbook(detail)
  const sheet = workbook.getWorksheet('최종 적재 요약')!
  expect(sheet.getRow(2).values).toEqual([, 1, 1, 3, 1.801, 45.125])
})
