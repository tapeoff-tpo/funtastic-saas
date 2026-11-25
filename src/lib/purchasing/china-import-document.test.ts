import type { ImportDocumentEditCells } from './china-import-editing'
import { renderChinaImportPreview } from './china-import-preview'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportChinaImportDocument, formatBoxMarks, importUnitPriceCny, prepareImportDocument, type ImportDocumentDetail, type ImportDocumentOptions, type ImportItemMetadata } from './china-import-document'

const detail: ImportDocumentDetail = {
  shipment: { shipmentNo: 'CN-TEST', status: 'ready', originWarehouseCode: '중국창고', destinationName: '인천', plannedOutboundDate: '2026-10-30', createdAt: '2026-10-30' },
  items: [
    { id: 'item-a', warehouseCode: '중국창고', sku: 'SKU-A', productName: '상품A', optionName: '대', reservedQuantity: 20, packedQuantity: 20 },
    { id: 'item-b', warehouseCode: '중국창고', sku: 'SKU-B', productName: '상품B', optionName: null, reservedQuantity: 5, packedQuantity: 5 },
  ],
  boxes: [
    { id: 'box-a', boxNo: '1', palletId: 'pallet-a', status: 'open', lengthCm: 50, widthCm: 40, heightCm: 30 },
    { id: 'box-b', boxNo: '2', palletId: null, status: 'open' },
  ],
  pallets: [{ id: 'pallet-a', palletNo: 'P1' }, { id: 'empty-pallet', palletNo: 'EMPTY' }],
  boxItems: [
    { id: 'a', boxId: 'box-a', shipmentItemId: 'item-a', quantity: 20 },
    { id: 'b', boxId: 'box-a', shipmentItemId: 'item-b', quantity: 2 },
    { id: 'c', boxId: 'box-b', shipmentItemId: 'item-b', quantity: 3 },
  ],
}
const metadata = new Map<string, ImportItemMetadata>([
  ['SKU-A', { englishName: 'Glass', chineseName: '玻璃杯', hsCode: '7013', material: '유리', unitPriceCny: 16.758 }],
  ['SKU-B', { englishName: 'Tray', chineseName: '托盘', hsCode: '', material: 'PP', unitPriceCny: 2 }],
])
const options: ImportDocumentOptions = {
  invoiceNo: 'TAPE-1', invoiceDate: '2026-10-30', sailingDate: '2026-10-31',
  exporter: 'Exporter', importer: 'TAPEOFF', importerAddress: 'Seoul', loadingPort: 'WEIHAI', destinationPort: 'INCHEON', paymentTerms: 'BY T/T',
  palletTareKg: 5, palletExtraCbm: 0.3,
  items: { 'item-a': { englishName: 'Glass', unitPriceCny: 16.758 }, 'item-b': { englishName: 'Tray', unitPriceCny: 2 } },
  boxes: { 'box-a': { grossWeightKg: 10, cbm: 0.06 }, 'box-b': { grossWeightKg: 3, cbm: 0.02 } },
}

function splitAcrossPallets(quantities: number[], unitPriceCny = 2) {
  const shipment: ImportDocumentDetail = {
    ...detail,
    items: [{ ...detail.items[0], reservedQuantity: quantities.reduce((sum, value) => sum + value, 0) }],
    pallets: quantities.map((_, index) => ({ id: `pallet-${index}`, palletNo: `P${index + 1}` })),
    boxes: quantities.map((_, index) => ({ id: `box-${index}`, boxNo: `BOX-${index + 1}`, palletId: `pallet-${index}`, status: 'open' })),
    boxItems: quantities.map((quantity, index) => ({ id: `allocation-${index}`, boxId: `box-${index}`, shipmentItemId: 'item-a', quantity })),
  }
  const overrides: ImportDocumentOptions = {
    ...options,
    items: { 'item-a': { englishName: 'Glass', unitPriceCny } },
    boxes: Object.fromEntries(shipment.boxes.map((box) => [box.id, { grossWeightKg: 1, cbm: 0.01 }])),
  }
  return { shipment, overrides }
}

async function exportedSheet(shipment: ImportDocumentDetail, overrides: ImportDocumentOptions) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportChinaImportDocument(shipment, metadata, overrides) as unknown as ExcelJS.Buffer)
  return workbook.worksheets[0]
}

describe('China import documents', () => {
  it('counts a shared option carton once after quantity-proportional weight and CBM allocation', async () => {
    const shared: ImportDocumentDetail = {
      ...detail,
      items: [
        { ...detail.items[0], productName: '켈디 지퍼고리', optionName: '실버', reservedQuantity: 50, packedQuantity: 50 },
        { ...detail.items[1], productName: '켈디 지퍼고리', optionName: '블랙', reservedQuantity: 100, packedQuantity: 100 },
      ],
      pallets: [],
      boxes: [{ ...detail.boxes[0], palletId: null, grossWeightKg: 8, manualCbm: 0.003308, lengthCm: 14.9, widthCm: 14.9, heightCm: 14.9 }],
      boxItems: [
        { id: 'silver', boxId: 'box-a', shipmentItemId: 'item-a', quantity: 50 },
        { id: 'black', boxId: 'box-a', shipmentItemId: 'item-b', quantity: 100 },
      ],
    }
    const prepared = prepareImportDocument(shared, metadata)
    expect(prepared.packageCount).toBe(1)
    expect(prepared.boxes).toHaveLength(1)
    const sheet = await exportedSheet(shared, { ...options, boxes: { 'box-a': { grossWeightKg: 8, cbm: 0.003308 } } })
    expect(sheet.getCell('E112').value).toEqual({ formula: 'SUM(E20:E111)', result: 150 })
    expect(sheet.getCell('V112').value).toEqual({ formula: 'SUM(V20:V111)', result: 8 })
    expect(sheet.getCell('X112').value).toBeCloseTo(0.003308, 6)
    expect(sheet.getCell('W14').value).toBe(1)
  })

  it('compresses consecutive numeric carton marks into ranges', () => {
    expect(formatBoxMarks(['1', '2', '3', '4', '5', '20'])).toBe('1~5, 20')
    expect(formatBoxMarks(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'])).toBe('1~20')
    expect(formatBoxMarks(['1', '3', '5'])).toBe('1, 3, 5')
    expect(formatBoxMarks(['BOX-1', 'BOX-2'])).toBe('BOX-1, BOX-2')
  })
  it.each([
    [[60, 20, 10], 'P1'],
    [[10, 60, 20], 'P2'],
    [[10, 20, 60], 'P3'],
    [[40, 40, 10], 'P1'],
  ] as const)('combines invoice quantities %j at %s with matching packing rows and all pallet locations', async (quantities, palletNo) => {
    const { shipment, overrides } = splitAcrossPallets([...quantities])
    const sheet = await exportedSheet(shipment, overrides)
    expect(sheet.getCell('A20').value).toBe('BOX-1, BOX-2, BOX-3')
    expect(sheet.getCell('B20').value).toBeNull()
    expect(sheet.getCell('C20').value).toBe('Glass')
    expect(sheet.getCell('D20').value).toBe('7013')
    expect(sheet.getCell('E20').value).toBe(90)
    expect(sheet.getCell('J20').value).toEqual({ formula: 'ROUND(G20*E20,2)', result: 180 })
    for (const row of [21, 22]) {
      for (let column = 1; column <= 10; column++) expect(sheet.getRow(row).getCell(column).value).toBeNull()
    }
    expect([20, 21, 22].map((row) => sheet.getCell(`M${row}`).value)).toEqual([null, null, null])
    expect([20, 21, 22].map((row) => sheet.getCell(`R${row}`).value)).toEqual([90, null, null])
    expect(sheet.getCell('K20').value).toBe(sheet.getCell('A20').value)
    expect(sheet.getCell('E112').value).toEqual({ formula: 'SUM(E20:E111)', result: 90 })
    expect(sheet.getCell('O112').value).toEqual({ formula: 'SUM(O20:O111)', result: 3 })
    expect(sheet.getCell('V112').value).toEqual({ formula: 'SUM(V20:V111)', result: 18 })
  })
  it('writes one numeric carton range for an item packed across consecutive boxes', async () => {
    const boxCount = 20
    const shipment: ImportDocumentDetail = {
      ...detail,
      items: [{ ...detail.items[0], reservedQuantity: boxCount, packedQuantity: boxCount }],
      pallets: [],
      boxes: Array.from({ length: boxCount }, (_, index) => ({ id: `box-${index + 1}`, boxNo: String(index + 1), palletId: null, status: 'open' })),
      boxItems: Array.from({ length: boxCount }, (_, index) => ({ id: `allocation-${index + 1}`, boxId: `box-${index + 1}`, shipmentItemId: 'item-a', quantity: 1 })),
    }
    const overrides: ImportDocumentOptions = {
      ...options,
      items: { 'item-a': { englishName: 'Glass', unitPriceCny: 2 } },
      boxes: Object.fromEntries(shipment.boxes.map((box) => [box.id, { grossWeightKg: 1, cbm: 0.01 }])),
    }

    const sheet = await exportedSheet(shipment, overrides)
    expect(sheet.getCell('A20').value).toBe('1~20')
    expect(sheet.getCell('K20').value).toBe('1~20')
    expect(sheet.getCell('L20').value).toBe(boxCount)
  })
  it('chooses the largest per-SKU pallet total even when the SKU has multiple shipment item IDs', async () => {
    const shipment: ImportDocumentDetail = {
      ...detail,
      items: [
        { ...detail.items[0], reservedQuantity: 95 },
        { ...detail.items[1], sku: ' SKU-A ', reservedQuantity: 35 },
      ],
      pallets: [{ id: 'pallet-a', palletNo: 'P1' }, { id: 'pallet-b', palletNo: 'P2' }],
      boxes: [detail.boxes[0], { ...detail.boxes[1], palletId: 'pallet-b' }],
      boxItems: [
        { id: 'a', boxId: 'box-a', shipmentItemId: 'item-a', quantity: 35 },
        { id: 'b', boxId: 'box-a', shipmentItemId: 'item-b', quantity: 35 },
        { id: 'c', boxId: 'box-b', shipmentItemId: 'item-a', quantity: 60 },
      ],
    }
    const overrides = { ...options, items: { 'item-a': { englishName: 'Glass', unitPriceCny: 1.25 }, 'item-b': { englishName: 'Glass', unitPriceCny: 1.25 } } }
    const sheet = await exportedSheet(shipment, overrides)
    expect(sheet.getCell('B20').value).toBeNull()
    expect(sheet.getCell('E20').value).toBe(130)
    expect(sheet.getCell('C21').value).toBeNull()
    expect(sheet.getCell('J112').value).toEqual({ formula: 'SUM(J20:J111)', result: 162.5 })
    expect([20, 21, 22].map((row) => sheet.getCell(`R${row}`).value)).toEqual([130, null, null])
    expect(sheet.model.merges).not.toContain('O20:O21')
    for (const conflicting of [{ englishName: 'Other', unitPriceCny: 1.25 }, { englishName: 'Glass', unitPriceCny: 2 }]) {
      await expect(exportChinaImportDocument(shipment, metadata, { ...overrides, items: { ...overrides.items, 'item-b': conflicting } })).rejects.toThrow('SKU-A: 동일 품목')
    }
  })
  it('keeps different SKUs separate even when their names are identical', async () => {
    const sheet = await exportedSheet(detail, { ...options, items: { ...options.items, 'item-b': { englishName: 'Glass', unitPriceCny: 2 } } })
    expect([sheet.getCell('C20').value, sheet.getCell('C21').value]).toEqual(['Glass', 'Glass'])
    expect([sheet.getCell('E20').value, sheet.getCell('E21').value]).toEqual([20, 5])
    expect(sheet.getCell('B21').value).toBe('1 BOX')
    expect(sheet.getCell('C22').value).toBeNull()
  })
  it('rounds the combined invoice amount once and totals the displayed lines', async () => {
    const { shipment, overrides } = splitAcrossPallets([1, 1, 1], 0.335)
    const sheet = await exportedSheet(shipment, overrides)
    expect(sheet.getCell('G20').value).toBe(0.335)
    expect(sheet.getCell('J20').value).toEqual({ formula: 'ROUND(G20*E20,2)', result: 1.01 })
    expect(sheet.getCell('J112').value).toEqual({ formula: 'SUM(J20:J111)', result: 1.01 })
  })
  it('uses the purchasing CNY price precedence without inventing missing prices', () => {
    expect(importUnitPriceCny({ '특가(元)': '16.758', '신규원가(元)': '20' })).toBe(16.758)
    expect(importUnitPriceCny({ '특가(元)': '0', '신규원가(元)': '1,234.5' })).toBe(1234.5)
    expect(importUnitPriceCny({ '특가(元)': '', '신규원가(元)': 'bad', '상품원가(元)': '50' })).toBeNull()
  })
  it('counts occupied pallets and loose boxes, with quantities from saved allocations', () => {
    const prepared = prepareImportDocument(detail, metadata)
    expect(prepared).toMatchObject({ boxCount: 2, palletCount: 1, looseBoxCount: 1, packageCount: 2 })
    expect(prepared.items.map((item) => item.quantity)).toEqual([20, 5])
  })
  it('uses the measured loaded pallet volume once plus loose boxes in final CBM', async () => {
    const measured = { ...detail, pallets: [{ ...detail.pallets[0]!, lengthCm: 120, widthCm: 100, heightCm: 150 }] }
    const buffer = await exportChinaImportDocument(measured, metadata, options)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    expect(workbook.getWorksheet('sheet')!.getCell('X112').value).toBeCloseTo(1.82)
  })
  it('prefills and exports direct CBM without requiring or synthesising centimeter measurements', async () => {
    const shipment: ImportDocumentDetail = {
      ...detail,
      boxes: detail.boxes.map((box, index) => ({ ...box, lengthCm: null, widthCm: null, heightCm: null, grossWeightKg: index === 0 ? 10 : 3, manualCbm: index === 0 ? 0.125 : 0.025 })),
      pallets: [{ ...detail.pallets[0], manualCbm: 0.75 }],
    }
    const original = JSON.stringify(shipment)
    const prepared = prepareImportDocument(shipment, metadata)
    expect(prepared.boxes.map(({ cbm, grossWeightKg }) => ({ cbm, grossWeightKg }))).toEqual([
      { cbm: 0.125, grossWeightKg: 10 }, { cbm: 0.025, grossWeightKg: 3 },
    ])
    const sheet = await exportedSheet(shipment, {
      ...options,
      boxes: Object.fromEntries(prepared.boxes.map((box) => [box.id, { grossWeightKg: box.grossWeightKg!, cbm: box.cbm! }])),
    })
    expect(sheet.getCell('X112').value).toBeCloseTo(0.775)
    expect(sheet.getCell('V112').value).toEqual({ formula: 'SUM(V20:V111)', result: 18 })
    expect(JSON.stringify(shipment)).toBe(original)
    expect(shipment.boxes.every((box) => box.lengthCm === null && box.widthCm === null && box.heightCm === null)).toBe(true)
  })
  it('calculates pallet weight from box overrides plus default tare instead of legacy gross and preserves Chinese names', async () => {
    const measured = { ...detail, items: detail.items.map((item) => ({ ...item, chineseProductName: '出库名称' })), pallets: [{ ...detail.pallets[0]!, grossWeightKg: 25 }] }
    expect(prepareImportDocument(measured, metadata).items[0]!.chineseName).toBe('出库名称')
    const buffer = await exportChinaImportDocument(measured, metadata, options)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    expect(workbook.getWorksheet('sheet')!.getCell('V20').value).toBe(15)
    expect(workbook.getWorksheet('sheet')!.getCell('V112').value).toEqual({ formula: 'SUM(V20:V111)', result: 18 })
  })
  it.each([0, 7.125])('uses per-pallet tare %s once for a mixed box and recalculates edited document box weights', async (tareWeightKg) => {
    const shipment = { ...detail, pallets: [{ ...detail.pallets[0]!, grossWeightKg: 99, tareWeightKg }] }
    const overrides = { ...options, palletTareKg: 123, boxes: { ...options.boxes, 'box-a': { grossWeightKg: 12.25, cbm: 0.06 } } }
    const sheet = await exportedSheet(shipment, overrides)
    expect(prepareImportDocument(shipment, metadata).pallets[0].tareWeightKg).toBe(tareWeightKg)
    expect(sheet.getCell('V20').value).toBe(12.25 + tareWeightKg)
    expect(sheet.getCell('V21').value).toBe(3)
    expect(sheet.getCell('V112').value).toEqual({ formula: 'SUM(V20:V111)', result: 15.25 + tareWeightKg })
  })
  it('rejects incomplete packing instead of writing reserved stock as actual quantity', () => {
    expect(() => prepareImportDocument({ ...detail, boxItems: detail.boxItems.slice(0, 2) }, metadata)).toThrow('출고수량')
  })
  it('preserves unit price precision and counts a shared box weight and pallet packaging once', async () => {
    const original = JSON.stringify(detail)
    const buffer = await exportChinaImportDocument(detail, metadata, options)
    const archive = await JSZip.loadAsync(buffer)
    expect(await archive.file('xl/styles.xml')!.async('string')).toMatch(/<fonts\b[^>]*><font>.*?<name val="돋움"\/>/s)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const sheet = workbook.getWorksheet('sheet')!
    expect(sheet.getCell('G20').value).toBe(16.758)
    expect(sheet.getCell('C18').value).toBe('NAME')
    expect(sheet.getCell('D18').value).toBe('HS CODE')
    expect(sheet.getCell('D20').value).toBe('7013')
    expect(sheet.getCell('D21').value).toBeNull()
    expect(sheet.getCell('J20').value).toEqual({ formula: 'ROUND(G20*E20,2)', result: 335.16 })
    expect(sheet.getCell('V20').value).toBe(15)
    expect(sheet.getCell('V21').value).toBe(3)
    expect(sheet.getCell('V22').value).toBeNull()
    expect(sheet.getCell('V23').value).toBeNull()
    expect(sheet.getCell('V112').value).toEqual({ formula: 'SUM(V20:V111)', result: 18 })
    expect(sheet.getCell('J112').value).toEqual({ formula: 'SUM(J20:J111)', result: 345.16 })
    expect(sheet.getCell('X112').value).toBeCloseTo(0.38)
    expect(sheet.getCell('R14').value).toBe('1plt + 1ctn')
    expect(sheet.getCell('W14').value).toBe(2)
    expect(JSON.stringify(detail)).toBe(original)
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(['sheet', '신상품_HS미등록', '기존_HS코드'])
    expect(sheet.getCell('Y20').value).toBe('상품A')
    expect(sheet.getCell('Y110').value).toBeNull()
    expect(sheet.pageSetup.orientation).toBe('portrait')
    expect(sheet.pageSetup.scale).toBe(31)
    expect(sheet.getColumn('A').width).toBe(19.296875)
    expect(sheet.getColumn('N').width).toBe(28.59765625)
    expect(sheet.model.merges).toEqual(expect.arrayContaining(['A1:J1', 'K1:S1', 'R18:S18', 'T18:U18', 'V18:W18']))
    expect(sheet.model.merges).not.toContain('C18:D18')
    const reference = new ExcelJS.Workbook()
    await reference.xlsx.load(await readFile(join(process.cwd(), 'src/lib/purchasing/templates/china-invoice-packing-list.xlsx')) as unknown as ExcelJS.Buffer)
    const template = reference.worksheets[0]
    for (let column = 1; column <= 24; column++) expect(sheet.getColumn(column).width).toBe(template.getColumn(column).width)
    for (const address of ['A1', 'K1', 'A2', 'A3', 'E3', 'A18', 'C18', 'R18', 'V18']) {
      expect(sheet.getCell(address).style).toEqual(template.getCell(address).style)
    }
    expect(sheet.getCell('D18').style).toEqual(template.getCell('C18').style)
    expect(sheet.pageSetup.margins).toEqual(template.pageSetup.margins)
    expect(sheet.getRow(20).height).toBe(21)
    expect(sheet.getRow(20).hidden).toBe(false)
    expect(sheet.autoFilter).toBeUndefined()
  })
  it('extends the supplied body rows and relocates totals for a larger shipment', async () => {
    const items = Array.from({ length: 97 }, (_, index) => ({ ...detail.items[0], id: `item-${index}`, sku: `SKU-${index}`, reservedQuantity: 1, packedQuantity: 1 }))
    const large = { ...detail, items, boxes: [detail.boxes[0]], boxItems: items.map((item) => ({ id: item.id, boxId: 'box-a', shipmentItemId: item.id, quantity: 1 })) }
    const buffer = await exportChinaImportDocument(large, new Map(), { ...options, items: Object.fromEntries(items.map((item) => [item.id, { englishName: 'Glass', unitPriceCny: 1 }])) })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const sheet = workbook.worksheets[0]
    expect(sheet.getCell('E117').value).toEqual({ formula: 'SUM(E20:E116)', result: 97 })
    expect(sheet.getCell('J117').value).toEqual({ formula: 'SUM(J20:J116)', result: 97 })
    expect(sheet.getCell('O117').value).toEqual({ formula: 'SUM(O20:O116)', result: 1 })
    expect(sheet.getCell('I117').value).toBe('RMB')
    expect(sheet.pageSetup.printArea).toBe('A1:X118')
  })
  it('requires missing price and weight to be supplied explicitly', async () => {
    await expect(exportChinaImportDocument(detail, metadata, { ...options, items: {} })).rejects.toThrow('위안화 단가')
    await expect(exportChinaImportDocument(detail, metadata, { ...options, boxes: {} })).rejects.toThrow('총중량')
  })
  it('adds one missing-HS row per SKU with one embedded image and a separate registered-HS list', async () => {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE3sAAAAASUVORK5CYII=', 'base64')
    const workbook = new ExcelJS.Workbook()
    const buffer = await exportChinaImportDocument(detail, metadata, options, {
      productImages: new Map([['SKU-B', { buffer: image, width: 1, height: 1 }]]),
    })
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const missing = workbook.getWorksheet('신상품_HS미등록')!
    const existing = workbook.getWorksheet('기존_HS코드')!
    expect(missing.rowCount).toBe(2)
    expect(missing.getCell('B2').value).toBe('SKU-B')
    expect(missing.getCell('C2').value).toBe('상품B')
    expect(missing.getCell('E2').value).toBe('Tray')
    expect(missing.getCell('F2').value).toBe(5)
    expect(missing.getCell('G2').value).toBeNull()
    expect(missing.getImages()).toHaveLength(1)
    expect(existing.rowCount).toBe(2)
    expect(existing.getCell('A2').value).toBe('SKU-A')
    expect(existing.getCell('D2').value).toBe('7013')
    expect(existing.getImages()).toHaveLength(0)
    const archive = await JSZip.loadAsync(buffer)
    expect(Object.keys(archive.files).filter((name) => /^xl\/media\/[^/]+$/.test(name))).toHaveLength(1)
    expect(workbook.worksheets[0].getCell('E21').value).toBe(5)
  })
  it('keeps missing images and blank HS codes visible without inventing codes', async () => {
    const withoutHs = new Map([...metadata].map(([sku, item]) => [sku, { ...item, hsCode: '  ' }]))
    const buffer = await exportChinaImportDocument(detail, withoutHs, options, { productImages: new Map([['SKU-B', { error: 'unavailable' }]]) })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const missing = workbook.getWorksheet('신상품_HS미등록')!
    expect(missing.getCell('A2').value).toBe('이미지 없음')
    expect(missing.getCell('A3').value).toBe('이미지 불러오기 실패')
    expect([missing.getCell('B2').value, missing.getCell('B3').value]).toEqual(['SKU-A', 'SKU-B'])
    expect([missing.getCell('G2').value, missing.getCell('G3').value]).toEqual([null, null])
    expect(workbook.getWorksheet('기존_HS코드')!.getCell('A2').value).toBe('HS CODE가 등록된 상품이 없습니다.')
  })
  it('can include the supplied full registered-HS reference list while keeping codes as text', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await exportChinaImportDocument(detail, metadata, options, {
      existingHsItems: [
        { sku: '00001', productName: '다른 상품', hsCode: ' 0392.10-0000 ' },
        { sku: '00001', productName: '다른 상품', hsCode: '0392.10-0000' },
        { sku: 'UNKNOWN', productName: '코드 없음', hsCode: '' },
      ],
    }) as unknown as ExcelJS.Buffer)
    const existing = workbook.getWorksheet('기존_HS코드')!
    expect(existing.rowCount).toBe(2)
    expect(existing.getCell('A2').value).toBe('00001')
    expect(existing.getCell('D2').value).toBe('0392.10-0000')
    expect(existing.getCell('D2').numFmt).toBe('@')
  })
})

it('renders the exported invoice and packing worksheet with merged cells and escaped text', async () => {
  const html = await renderChinaImportPreview(await exportChinaImportDocument(detail, metadata, { ...options, exporter: '<script>alert(1)</script>' }))
  expect(html).toContain('INVOICE')
  expect(html).toContain('PACKING LIST')
  expect(html).toContain('colspan="10"')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).toContain('TAPE-1/ 2026-10-30')
})
it('shows a draft template even when prices and box measurements are missing without inventing totals', async () => {
  const buffer = await exportChinaImportDocument(detail, metadata, { ...options,
    items: { 'item-a': { englishName: '', unitPriceCny: Number.NaN }, 'item-b': { englishName: '', unitPriceCny: Number.NaN } },
    boxes: { 'box-a': { grossWeightKg: Number.NaN, cbm: null }, 'box-b': { grossWeightKg: Number.NaN, cbm: null } },
  }, {}, true)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  expect(sheet.getCell('G20').value).toBeNull()
  expect(sheet.getCell('J112').value).toBeNull()
  expect(sheet.getCell('V112').value).toBeNull()
  expect(sheet.getCell('X112').value).toBeNull()
  expect(await renderChinaImportPreview(buffer)).not.toContain('NaN')
})
it('exports the saved whole-pallet CBM when its internal boxes have no dimensions', async () => {
  const shipment = { ...detail, pallets: [{ ...detail.pallets[0], manualCbm: 1.5, tareWeightKg: 5 }] }
  const sheet = await exportedSheet(shipment, { ...options, boxes: { ...options.boxes, 'box-a': { grossWeightKg: 10, cbm: null } } })
  expect(sheet.getCell('X112').value).toBeCloseTo(1.52)
  expect(sheet.getCell('R112').value).toMatchObject({ result: 25 })
})

it('combines option suffixes by product on both documents while preserving option prices and physical totals', async () => {
  const shipment = { ...detail, items: [{ ...detail.items[0], sku: '100457-0001' }, { ...detail.items[1], sku: '100457-0002' }] }
  const trade = new Map([['100457-0001', { ...metadata.get('SKU-A')! }], ['100457-0002', { ...metadata.get('SKU-A')! }]])
  const overrides = { ...options, items: { 'item-a': { englishName: 'Glass', unitPriceCny: 10 }, 'item-b': { englishName: 'Glass red', unitPriceCny: 20 } } }
  const buffer = await exportChinaImportDocument(shipment, trade, overrides)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  expect(sheet.getCell('E20').value).toBe(25)
  expect(sheet.getCell('G20').value).toBe(12)
  expect(sheet.getCell('J20').value).toEqual({ formula: 'ROUND(G20*E20,2)', result: 300 })
  expect(sheet.getCell('C21').value).toBeNull()
  expect(sheet.getCell('R20').value).toBe(25)
  expect(sheet.getCell('R21').value).toBeNull()
  expect(sheet.getCell('L20').value).toBe(2)
  expect(sheet.getCell('L21').value).toBeNull()
  expect(sheet.getCell('K20').value).toBe(sheet.getCell('A20').value)
  expect(sheet.getCell('M20').value).toBe('1 BOX')
  expect(sheet.getCell('O20').value).toBe(2)
  expect(sheet.getCell('O112').value).toMatchObject({ result: 2 })
  expect(sheet.getCell('V112').value).toMatchObject({ result: 18 })
  expect(sheet.getCell('X112').value).toBeCloseTo(0.38)
  expect(prepareImportDocument(shipment, trade).items).toHaveLength(2)
})
it('keeps different products separate even when the English name is identical', async () => {
  const shipment = { ...detail, items: [{ ...detail.items[0], sku: '100457-0001' }, { ...detail.items[1], sku: '100458-0001' }] }
  const overrides = { ...options, items: { 'item-a': { englishName: 'Glass', unitPriceCny: 10 }, 'item-b': { englishName: 'Glass', unitPriceCny: 10 } } }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportChinaImportDocument(shipment, metadata, overrides) as unknown as ExcelJS.Buffer)
  expect(workbook.worksheets[0].getCell('E20').value).toBe(20)
  expect(workbook.worksheets[0].getCell('E21').value).toBe(5)
})

it('displays unit prices with exactly two decimal places while preserving calculation precision', async () => {
  const buffer = await exportChinaImportDocument(detail, metadata, options)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  expect(sheet.getCell('G20').numFmt).toBe('#,##0.00')
  expect(sheet.getCell('G20').value).toBe(16.758)
  expect(sheet.getCell('J20').value).toMatchObject({ result: 335.16 })
  const html = await renderChinaImportPreview(buffer)
  expect(html).toContain('>16.76</td>')
  expect(html).toContain('>2.00</td>')
})

it('aligns every invoice and packing product row without repeating mixed packages', async () => {
  const sheet = await exportedSheet(detail, options)
  for (const row of [20, 21]) {
    expect(sheet.getCell(`K${row}`).value).toBe(sheet.getCell(`A${row}`).value)
    expect(sheet.getCell(`R${row}`).value).toBe(sheet.getCell(`E${row}`).value)
  }
  expect(sheet.getCell('M21').value).toBe('1 BOX')
  expect(sheet.getCell('O20').value).toBe(1)
  expect(sheet.getCell('O21').value).toBe(1)
  expect(sheet.getCell('L20').value).toBe(1)
  expect(sheet.getCell('L21').value).toBe(1)
  expect(sheet.getCell('V20').value).toBe(15)
  expect(sheet.getCell('V21').value).toBe(3)
  expect(sheet.getCell('K22').value).toBeNull()
})

it('places safe editable inputs in the exported template and applies changed HS codes to download', async () => {
  const cells: ImportDocumentEditCells = {}
  const edited = { ...options, items: { ...options.items, 'item-a': { ...options.items['item-a'], hsCode: '0392.10' } } }
  const buffer = await exportChinaImportDocument(detail, metadata, edited, {}, true, cells)
  expect(cells.E3.map((field) => field.key)).toEqual(['invoiceNo', 'invoiceDate'])
  expect(cells.G20[0]).toMatchObject({ key: 'product:SKU-A:unitPriceCny', value: '16.76' })
  expect(cells.D20[0].value).toBe('0392.10')
  const html = await renderChinaImportPreview(buffer, cells)
  expect(html).toContain('data-edit-key="invoiceNo"')
  expect(html).toContain('data-edit-key="product:SKU-A:hsCode"')
  expect(html).not.toContain('<script')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportChinaImportDocument(detail, metadata, edited) as unknown as ExcelJS.Buffer)
  expect(workbook.worksheets[0].getCell('D20').value).toBe('0392.10')
})

it('shows Korean product names to the right of the packing preview but keeps them visible in Excel outside the print area', async () => {
  const buffer = await exportChinaImportDocument(detail, metadata, options)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  expect(sheet.getColumn('Y').hidden).toBe(false)
  expect(sheet.getCell('Y18').value).toBe('상품명 (확인용)')
  expect(sheet.getCell('Y20').value).toBe('상품A')
  expect(sheet.pageSetup.printArea).toBe('A1:X113')
  const html = await renderChinaImportPreview(buffer)
  expect(html).toContain('상품명 (확인용)')
  expect(html).toContain('상품A')
  expect(html).toContain('상품B')
})

it('retains an available option image after grouping options into one product in the new-item sheet', async () => {
  const sharp = (await import('sharp')).default
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const shipment = { ...detail, items: [{ ...detail.items[0], sku: '100457-0001' }, { ...detail.items[1], sku: '100457-0002' }] }
  const overrides = { ...options, items: { 'item-a': { englishName: 'Glass', unitPriceCny: 10 }, 'item-b': { englishName: 'Glass', unitPriceCny: 10 } } }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exportChinaImportDocument(shipment, new Map(), overrides, { productImages: new Map([['100457-0001', { error: 'unavailable' }], ['100457-0002', { buffer: png, width: 10, height: 10 }]]) }) as unknown as ExcelJS.Buffer)
  const sheet = workbook.getWorksheet('신상품_HS미등록')!
  expect(sheet.getCell('B2').value).toBe('100457')
  expect(sheet.getImages()).toHaveLength(1)
  expect(sheet.getCell('A2').value).toBeNull()
})

it('uses TAPEOFF quarantine text and a single 1.3 surcharge without changing base inputs', async () => {
  const trade = new Map(metadata)
  trade.set('SKU-A', { ...metadata.get('SKU-A')!, quarantineText: '식품검역' })
  const adjusted = { ...options, template: 'tapeoff' as const }
  const cells: ImportDocumentEditCells = {}
  const buffer = await exportChinaImportDocument(detail, trade, adjusted, {}, true, cells)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  expect(sheet.getCell('X20').value).toBe('식품검역')
  expect(sheet.getCell('X21').value).toBeNull()
  expect(sheet.getCell('G20').value).toBe(21.79)
  expect(sheet.getCell('J20').value).toMatchObject({ result: 435.8 })
  expect(sheet.getCell('G21').value).toBe(2.6)
  expect(options.items['item-a'].unitPriceCny).toBe(16.758)
  expect(cells.G20).toBeUndefined()
  const ssj = await exportedSheet(detail, options)
  expect(ssj.getCell('G20').value).toBe(16.758)
  expect(ssj.getCell('X20').value).toBeNull()
})

it.each(['ssj', 'tapeoff'] as const)('shows only loose-box counts for a product across pallets and BOX in %s', async (template) => {
  const { shipment, overrides } = splitAcrossPallets([10, 20, 30])
  shipment.boxes[2].palletId = null
  const sheet = await exportedSheet(shipment, { ...overrides, template })
  expect(sheet.getCell('M20').value).toBe('1 BOX')
  expect(sheet.getCell('B20').value).toBe('1 BOX')
  expect(sheet.getCell('O20').value).toBe(3)
  expect(sheet.getCell('R14').value).toBe('2plt + 1ctn')
  expect(sheet.getCell('W14').value).toBe(3)
})
