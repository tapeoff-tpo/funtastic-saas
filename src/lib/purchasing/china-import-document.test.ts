import ExcelJS from 'exceljs'
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
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const sheet = workbook.getWorksheet('INVOICE & PACKING LIST')!
    expect(sheet.getCell('G20').value).toBe(16.758)
    expect(sheet.getCell('J20').value).toEqual({ formula: 'ROUND(E20*G20,2)', result: 335.16 })
    expect(sheet.getCell('V20').value).toBe(10)
    expect(sheet.getCell('V21').value).toBeNull()
    expect(sheet.getCell('V22').value).toBe(3)
    expect(sheet.getCell('V23').value).toBe(5)
    expect(sheet.getCell('V24').value).toEqual({ formula: 'SUM(V20:V23)', result: 18 })
    expect(sheet.getCell('J24').value).toEqual({ formula: 'SUM(J20:J23)', result: 345.16 })
    expect((sheet.getCell('X24').value as ExcelJS.CellFormulaValue).result).toBeCloseTo(0.38)
    expect(sheet.getCell('R17').value).toContain('1 PLT + 1 CTN = 2 PACKAGES')
    expect(JSON.stringify(detail)).toBe(original)
    expect(workbook.getWorksheet('품목정보(商品信息)')?.getCell('F2').value).toBe('7013')
  })
  it('requires missing price and weight to be supplied explicitly', async () => {
    await expect(exportChinaImportDocument(detail, metadata, { ...options, items: {} })).rejects.toThrow('위안화 단가')
    await expect(exportChinaImportDocument(detail, metadata, { ...options, boxes: {} })).rejects.toThrow('총중량')
  })
})
