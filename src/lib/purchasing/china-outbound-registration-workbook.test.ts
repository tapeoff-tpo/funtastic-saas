import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  CHINA_OUTBOUND_REGISTRATION_BOX_DISPLAY_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_BOX_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_INVENTORY_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_ITEM_DISPLAY_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_ITEM_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_SHIPMENT_DISPLAY_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_SHIPMENT_HEADERS,
  CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_NAME,
  CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_SHEET,
  CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS,
  createChinaOutboundRegistrationWorkbookFingerprint,
  exportChinaOutboundRegistrationTemplateWorkbook,
  parseChinaOutboundRegistrationWorkbook,
} from './china-outbound-registration-workbook'

describe('China outbound registration workbook', () => {
  it('exports the new-shipment template with a stable import key and warehouse dropdowns', async () => {
    const buffer = await exportChinaOutboundRegistrationTemplateWorkbook({
      importKey: 'CN-20261027-XLSX-TEST0001',
      defaultWarehouseCode: '중국창고',
      warehouseCodes: [' 쿠팡 ', '중국창고', '스마일배송', '쿠팡', ''],
      currentInventory: [{
        warehouseCode: '중국창고',
        sku: 'SKU-A',
        productName: '멜팅 스윗 도넛 플레이트 세트',
        optionName: '대',
        itemCategory: '[상품]',
        onHandQuantity: 100,
        reservedQuantity: 20,
        availableQuantity: 80,
        lastReceivedAt: '2026-10-21T00:00:00+09:00',
        lastOutboundAt: '2026-10-22T00:00:00+09:00',
      }],
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment,
      CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items,
      CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes,
      CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.inventory,
      CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_SHEET,
    ])
    const shipment = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)
    const items = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)
    const boxes = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)
    const inventory = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.inventory)
    const warehouseOptions = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_SHEET)

    expect(shipment?.getCell('A2').value)
      .toBe('CN-20261027-XLSX-TEST0001')
    expect(shipment?.getCell('D2').value)
      .toBe('중국창고')
    expect(shipment?.getRow(1).values)
      .toEqual([undefined, ...CHINA_OUTBOUND_REGISTRATION_SHIPMENT_DISPLAY_HEADERS])
    expect(items?.getRow(1).values)
      .toEqual([undefined, ...CHINA_OUTBOUND_REGISTRATION_ITEM_DISPLAY_HEADERS])
    expect(boxes?.getRow(1).values)
      .toEqual([undefined, ...CHINA_OUTBOUND_REGISTRATION_BOX_DISPLAY_HEADERS])
    expect(inventory?.getRow(1).values)
      .toEqual([undefined, ...CHINA_OUTBOUND_REGISTRATION_INVENTORY_HEADERS])
    expect(inventory?.getRow(2).values).toEqual([
      undefined,
      '중국창고',
      'SKU-A',
      '멜팅 스윗 도넛 플레이트 세트',
      '대',
      '상품 / 商品',
      100,
      20,
      80,
      '2026-10-21',
      '2026-10-22',
    ])
    expect(inventory?.rowCount).toBe(2)
    expect(inventory?.getCell('A3').value).toBeNull()
    expect(warehouseOptions?.state).toBe('veryHidden')
    expect(warehouseOptions?.getColumn(1).values).toEqual([
      undefined,
      '중국창고',
      '쿠팡',
      '스마일배송',
    ])
    expect(workbook.definedNames.getRanges(CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_NAME)).toEqual({
      name: CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_NAME,
      ranges: [`'${CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_SHEET}'!$A$1:$A$3`],
    })

    const warehouseDropdown = {
      type: 'list',
      allowBlank: true,
      formulae: [`=${CHINA_OUTBOUND_REGISTRATION_WAREHOUSE_OPTIONS_NAME}`],
    }
    expect(shipment?.getCell('D2').dataValidation).toMatchObject(warehouseDropdown)
    expect(items?.getCell('A2').dataValidation).toMatchObject(warehouseDropdown)
    expect(items?.getCell('A1001').dataValidation).toMatchObject(warehouseDropdown)
    expect(boxes?.getCell('A2').dataValidation).toMatchObject(warehouseDropdown)
    expect(boxes?.getCell('A5001').dataValidation).toMatchObject(warehouseDropdown)
  })

  it('keeps the shared bilingual layout while pre-filling an existing outbound task', async () => {
    const buffer = await exportChinaOutboundRegistrationTemplateWorkbook({
      importKey: 'CN-20261028-PREFILLED01',
      defaultWarehouseCode: '중국창고',
      warehouseCodes: ['중국창고', '쿠팡'],
      prefilledShipment: {
        displayName: '10월 중국출고 작업',
        destinationName: '인천',
        plannedOutboundDate: '2026-10-30',
        memo: '기존 출고요청 작업용',
      },
      prefilledItems: [
        { warehouseCode: '중국창고', sku: 'SKU-A', optionName: '블랙', quantity: 100 },
        { warehouseCode: '쿠팡', sku: 'SKU-B', optionName: null, quantity: 20 },
      ],
      prefilledBoxAllocations: [{
        warehouseCode: '중국창고',
        sku: 'SKU-A',
        optionName: '블랙',
        boxNo: 'BOX-01',
        quantity: 40,
        lengthCm: 50,
        widthCm: 40,
        heightCm: 30,
        palletNo: 'PALLET-1',
      }],
      includeBlankBoxPlaceholders: true,
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)

    const shipment = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
    const items = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
    const boxes = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!

    expect(shipment.getRow(1).values).toEqual([
      undefined,
      ...CHINA_OUTBOUND_REGISTRATION_SHIPMENT_DISPLAY_HEADERS,
    ])
    expect(items.getRow(1).values).toEqual([
      undefined,
      ...CHINA_OUTBOUND_REGISTRATION_ITEM_DISPLAY_HEADERS,
    ])
    expect(boxes.getRow(1).values).toEqual([
      undefined,
      ...CHINA_OUTBOUND_REGISTRATION_BOX_DISPLAY_HEADERS,
    ])
    expect(shipment.getRow(2).values).toEqual([
      undefined,
      'CN-20261028-PREFILLED01',
      '10월 중국출고 작업',
      '인천',
      '중국창고',
      '2026-10-30',
      '기존 출고요청 작업용',
    ])
    expect(items.getRow(2).values).toEqual([undefined, '중국창고', 'SKU-A', '블랙', 100])
    expect(items.getRow(3).values).toEqual([undefined, '쿠팡', 'SKU-B', '', 20])
    expect(boxes.getRow(2).values).toEqual([
      undefined,
      '중국창고',
      'SKU-A',
      '블랙',
      'BOX-01',
      40,
      50,
      40,
      30,
      'PALLET-1',
    ])
    expect(boxes.getRow(3).values).toEqual([
      undefined,
      '중국창고',
      'SKU-A',
      '블랙',
      '',
      '',
      '',
      '',
      '',
      '',
    ])
    expect(boxes.getRow(4).values).toEqual([
      undefined,
      '쿠팡',
      'SKU-B',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ])
  })

  it('parses a generated bilingual template and its box/pallet allocation together', async () => {
    const template = await exportChinaOutboundRegistrationTemplateWorkbook({
      importKey: 'CN-20261027-XLSX-BILINGUAL1',
      defaultWarehouseCode: '중국창고',
      warehouseCodes: ['중국창고', '쿠팡'],
    })
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(template as unknown as ExcelJS.Buffer)
    const shipment = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
    shipment.getCell('B2').value = '10월 중국출고'
    shipment.getCell('C2').value = '인천'
    shipment.getCell('E2').value = '2026-10-27'
    shipment.getCell('F2').value = '포워더 전달'
    const items = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
    items.getCell('B2').value = 'SKU-A'
    items.getCell('C2').value = '블랙'
    items.getCell('D2').value = 100
    const boxes = workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.boxes)!
    boxes.getCell('B2').value = 'SKU-A'
    boxes.getCell('C2').value = '블랙'
    boxes.getCell('D2').value = 'BOX-01'
    boxes.getCell('E2').value = 100
    boxes.getCell('F2').value = 50
    boxes.getCell('G2').value = 40
    boxes.getCell('H2').value = 30
    boxes.getCell('I2').value = 'PALLET-1'

    const parsed = await parseChinaOutboundRegistrationWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed.errors).toEqual([])
    expect(parsed).toMatchObject({
      importKey: 'CN-20261027-XLSX-BILINGUAL1',
      displayName: '10월 중국출고',
      destinationName: '인천',
      defaultWarehouseCode: '중국창고',
      plannedOutboundDate: '2026-10-27',
      memo: '포워더 전달',
      items: [{ warehouseCode: '중국창고', sku: 'SKU-A', optionName: '블랙', quantity: 100 }],
      boxAllocations: [{
        warehouseCode: '중국창고', sku: 'SKU-A', optionName: '블랙', boxNo: 'BOX-01', quantity: 100,
        lengthCm: 50, widthCm: 40, heightCm: 30, palletNo: 'PALLET-1',
      }],
    })
  })

  it('allows a prefilled working workbook to keep blank box rows and incomplete packing in relaxed mode', async () => {
    const template = await exportChinaOutboundRegistrationTemplateWorkbook({
      importKey: 'CN-20261028-WORKMODE01',
      prefilledItems: [{ warehouseCode: '중국창고', sku: 'SKU-A', optionName: '블랙', quantity: 100 }],
      prefilledBoxAllocations: [{
        warehouseCode: '중국창고',
        sku: 'SKU-A',
        optionName: '블랙',
        boxNo: 'BOX-01',
        quantity: 40,
        palletNo: 'PALLET-1',
      }],
      includeBlankBoxPlaceholders: true,
    })

    const parsed = await parseChinaOutboundRegistrationWorkbook(template, {
      requireCompleteBoxAllocations: false,
      ignoreBlankBoxPlaceholders: true,
      requireDestination: false,
    })

    expect(parsed.errors).toEqual([])
    expect(parsed.destinationName).toBeNull()
    expect(parsed.items).toEqual([
      expect.objectContaining({ warehouseCode: '중국창고', sku: 'SKU-A', optionName: '블랙', quantity: 100 }),
    ])
    expect(parsed.boxAllocations).toEqual([
      expect.objectContaining({ boxNo: 'BOX-01', quantity: 40, palletNo: 'PALLET-1' }),
    ])
  })

  it('continues to parse a legacy Korean-only workbook with box/pallet allocation', async () => {
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

  it('ignores the read-only current China inventory sheet during import', async () => {
    const workbook = createWorkbook()
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.shipment)!
      .addRow(['CN-20261027-XLSX-REFERENCE1', '', '인천', '', '', ''])
    workbook.getWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.items)!
      .addRow(['중국창고', 'SKU-A', '', 10])
    const inventory = workbook.addWorksheet(CHINA_OUTBOUND_REGISTRATION_WORKBOOK_SHEETS.inventory)
    inventory.addRow([...CHINA_OUTBOUND_REGISTRATION_INVENTORY_HEADERS])
    inventory.addRow(['중국창고', 'SKU-A', '참조용 상품', '', '상품 / 商品', 100, 0, 100, '', ''])

    const parsed = await parseChinaOutboundRegistrationWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed.errors).toEqual([])
    expect(parsed.items).toEqual([expect.objectContaining({ warehouseCode: '중국창고', sku: 'SKU-A', quantity: 10 })])
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
