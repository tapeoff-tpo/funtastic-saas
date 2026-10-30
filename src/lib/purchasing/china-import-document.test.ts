import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportChinaImportDocument, importUnitPriceCny, prepareImportDocument, type ImportDocumentDetail, type ImportDocumentOptions, type ImportItemMetadata } from './china-import-document'

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

describe('China import documents', () => {
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
    expect(sheet.getCell('J20').value).toEqual({ formula: 'ROUND(G20*E20,2)', result: 335.16 })
    expect(sheet.getCell('V20').value).toBe(15)
    expect(sheet.getCell('V21').value).toBeNull()
    expect(sheet.getCell('V22').value).toBe(3)
    expect(sheet.getCell('V23').value).toBeNull()
    expect(sheet.getCell('V112').value).toEqual({ formula: 'SUM(V20:V111)', result: 18 })
    expect(sheet.getCell('J112').value).toEqual({ formula: 'SUM(J20:J111)', result: 345.16 })
    expect(sheet.getCell('X112').value).toBeCloseTo(0.38)
    expect(sheet.getCell('R14').value).toBe('1plt + 1ctn')
    expect(sheet.getCell('W14').value).toBe(2)
    expect(JSON.stringify(detail)).toBe(original)
    expect(workbook.worksheets).toHaveLength(1)
    expect(sheet.getCell('Y20').value).toBe('상품A')
    expect(sheet.getCell('Y110').value).toBeNull()
    expect(sheet.pageSetup.orientation).toBe('portrait')
    expect(sheet.pageSetup.scale).toBe(31)
    expect(sheet.getColumn('A').width).toBe(19.296875)
    expect(sheet.getColumn('N').width).toBe(28.59765625)
    expect(sheet.model.merges).toEqual(expect.arrayContaining(['A1:J1', 'K1:S1', 'C18:D18', 'R18:S18', 'T18:U18', 'V18:W18', 'O20:O21']))
    const reference = new ExcelJS.Workbook()
    await reference.xlsx.load(await readFile(join(process.cwd(), 'src/lib/purchasing/templates/china-invoice-packing-list.xlsx')) as unknown as ExcelJS.Buffer)
    const template = reference.worksheets[0]
    for (let column = 1; column <= 24; column++) expect(sheet.getColumn(column).width).toBe(template.getColumn(column).width)
    for (const address of ['A1', 'K1', 'A2', 'A3', 'E3', 'A18', 'C18', 'R18', 'V18']) {
      expect(sheet.getCell(address).style).toEqual(template.getCell(address).style)
    }
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
})
