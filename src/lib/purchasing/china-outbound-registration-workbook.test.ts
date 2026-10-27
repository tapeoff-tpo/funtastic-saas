import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  CHINA_OUTBOUND_REGISTRATION_BOX_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_ITEM_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_SHIPMENT_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS,
  createChinaOutboundRegistrationWorkbookFingerprint,
  exportChinaOutboundRegistrationTemplateWorkbook,
  parseChinaOutboundRegistrationWorkbook,
} from './china-outbound-registration-workbook'

describe('China outbound registration workbook', () => {
  it('exports the new-shipment template with a stable import key', async () => {
    const buffer = await exportChinaOutboundRegistrationTemplateWorkbook({
      importKey: 'CN-20261027-XLSX-TEST0001',
      defaultWarehouseCode: '중국창고',
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.guide,
      CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment,
      CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items,
      CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes,
    ])
    expect(workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)?.getCell('A2').value)
      .toBe('CN-20261027-XLSX-TEST0001')
    expect(workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)?.getCell('D2').value)
      .toBe('중국창고')
    expect(workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)?.getRow(1).values)
      .toEqual([undefined, ...CHINA_OUTBOUND_REGISTRATION_SHIPMENT_HEADERS])
  })

  it('parses a new shipment and its box/pallet allocation together', async () => {
    const workbook = createWorkbook()
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
      .addRow(['CN-20261027-XLSX-VALID001', '10월 중국출고', '인천', '', '2026-10-27', '포워더 전달'])
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
      .addRow(['중국창고', 'SKU-A', '블랙', 100])
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!
      .addRow(['중국창고', 'SKU-A', '블랙', 'BOX-01', 100, 50, 40, 30, 'PALLET-1'])

    const parsed = await parseChinaOutboundRegistrationWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed.errors).toEqual([])
    expect(parsed).toMatchObject({
      importKey: 'CN-20261027-XLSX-VALID001',
      displayName: '10월 중국출고',
      destinationName: '인천',
      defaultWarehouseCode: null,
      plannedOutboundDate: '2026-10-27',
      memo: '포워더 전달',
      items: [{ warehouseCode: '중국창고', sku: 'SKU-A', optionName: '블랙', quantity: 100 }],
      boxAllocations: [{
        warehouseCode: '중국창고', sku: 'SKU-A', optionName: '블랙', boxNo: 'BOX-01', quantity: 100,
        lengthCm: 50, widthCm: 40, heightCm: 30, palletNo: 'PALLET-1',
      }],
    })
  })

  it('allows a shipment to be registered before box shipment work is available', async () => {
    const workbook = createWorkbook()
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
      .addRow(['CN-20261027-XLSX-NOBOX001', '', '평택', '', '', ''])
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
      .addRow(['중국창고', 'SKU-A', '', 20])

    const parsed = await parseChinaOutboundRegistrationWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed.errors).toEqual([])
    expect(parsed.boxAllocations).toEqual([])
  })

  it('inherits the default warehouse and allows per-row warehouse overrides', async () => {
    const workbook = createWorkbook()
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
      .addRow(['CN-20261027-XLSX-DEFAULT1', '복수 창고 출고', '인천', '중국창고', '', ''])
    const items = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
    items.addRow(['', 'SKU-A', '', 100])
    items.addRow(['쿠팡', 'SKU-B', '', 20])
    const boxes = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!
    boxes.addRow(['', 'SKU-A', '', 'BOX-01', 100, '', '', '', ''])
    boxes.addRow(['쿠팡', 'SKU-B', '', 'BOX-02', 20, '', '', '', ''])

    const parsed = await parseChinaOutboundRegistrationWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed.errors).toEqual([])
    expect(parsed.defaultWarehouseCode).toBe('중국창고')
    expect(parsed.items.map((item) => item.warehouseCode)).toEqual(['중국창고', '쿠팡'])
    expect(parsed.boxAllocations.map((allocation) => allocation.warehouseCode)).toEqual(['중국창고', '쿠팡'])
  })

  it('continues to accept a template downloaded before the default-warehouse column existed', async () => {
    const workbook = new ExcelJS.Workbook()
    const shipment = workbook.addWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)
    shipment.addRow(['엑셀등록번호', '출고작업명', '도착지', '출고예정일', '메모'])
    shipment.addRow(['CN-20261027-XLSX-LEGACY01', '기존 양식 출고', '인천', '2026-10-27', ''])
    const items = workbook.addWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)
    items.addRow([...CHINA_OUTBOUND_REGISTRATION_ITEM_HEADERS])
    items.addRow(['중국창고', 'SKU-A', '', 10])
    const boxes = workbook.addWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)
    boxes.addRow([...CHINA_OUTBOUND_REGISTRATION_BOX_HEADERS])

    const parsed = await parseChinaOutboundRegistrationWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed.errors).toEqual([])
    expect(parsed.defaultWarehouseCode).toBeNull()
    expect(parsed.items[0]).toMatchObject({ warehouseCode: '중국창고', sku: 'SKU-A', quantity: 10 })
  })

  it('flags a box allocation quantity that does not equal the outbound quantity', async () => {
    const workbook = createWorkbook()
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
      .addRow(['CN-20261027-XLSX-MISMATCH1', '', '부산', '', '', ''])
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
      .addRow(['중국창고', 'SKU-A', '', 100])
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!
      .addRow(['중국창고', 'SKU-A', '', 'BOX-01', 90, '', '', '', ''])

    const parsed = await parseChinaOutboundRegistrationWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed.errors.some((error) => error.message.includes('적재수량 합계 90개가 출고수량 100개와 같아야'))).toBe(true)
  })

  it('flags conflicting dimensions and pallet numbers for a shared box', async () => {
    const workbook = createWorkbook()
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
      .addRow(['CN-20261027-XLSX-CONFLICT1', '', '인천', '', '', ''])
    const items = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
    items.addRow(['중국창고', 'SKU-A', '', 50])
    items.addRow(['중국창고', 'SKU-B', '', 50])
    const boxes = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!
    boxes.addRow(['중국창고', 'SKU-A', '', 'BOX-01', 50, 50, 40, 30, 'PALLET-1'])
    boxes.addRow(['중국창고', 'SKU-B', '', 'BOX-01', 50, 60, 40, 30, 'PALLET-2'])

    const parsed = await parseChinaOutboundRegistrationWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed.errors.some((error) => error.message.includes('서로 다른 박스 규격'))).toBe(true)
    expect(parsed.errors.some((error) => error.message.includes('서로 다른 파렛트번호'))).toBe(true)
  })

  it('uses a stable registration fingerprint and changes it when shipment content changes', async () => {
    const workbook = createWorkbook()
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
      .addRow(['CN-20261027-XLSX-FINGER01', '', '인천', '', '', ''])
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
      .addRow(['중국창고', 'SKU-A', '', 10])
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
      .addRow(['중국창고', 'SKU-B', '', 20])
    const parsed = await parseChinaOutboundRegistrationWorkbook(await workbook.xlsx.writeBuffer())

    const sameContentInDifferentOrder = { ...parsed, items: [...parsed.items].reverse() }
    const changed = { ...parsed, memo: '변경' }
    expect(createChinaOutboundRegistrationWorkbookFingerprint(parsed))
      .toBe(createChinaOutboundRegistrationWorkbookFingerprint(sameContentInDifferentOrder))
    expect(createChinaOutboundRegistrationWorkbookFingerprint(changed)).not.toBe(
      createChinaOutboundRegistrationWorkbookFingerprint(parsed),
    )
  })
})

function createWorkbook() {
  const workbook = new ExcelJS.Workbook()
  const shipment = workbook.addWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)
  shipment.addRow([...CHINA_OUTBOUND_REGISTRATION_SHIPMENT_HEADERS])
  const items = workbook.addWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)
  items.addRow([...CHINA_OUTBOUND_REGISTRATION_ITEM_HEADERS])
  const boxes = workbook.addWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)
  boxes.addRow([...CHINA_OUTBOUND_REGISTRATION_BOX_HEADERS])
  return workbook
}
