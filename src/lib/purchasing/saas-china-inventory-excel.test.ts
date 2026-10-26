import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE,
  exportSaasChinaInventoryTemplateWorkbook,
  exportSaasChinaInventoryWorkbook,
  parseSaasChinaInventoryWorkbook,
  saasChinaInventoryExportFilename,
  SAAS_CHINA_INVENTORY_EXCEL_HEADERS,
  SAAS_CHINA_INVENTORY_STATUS_HEADERS,
  SAAS_CHINA_INVENTORY_STATUS_WAREHOUSE_CODES,
} from './saas-china-inventory-excel'

async function workbookBuffer(rows: Array<Array<string | number | null | undefined>>, headers = [...SAAS_CHINA_INVENTORY_EXCEL_HEADERS]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('재고')
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  return workbook.xlsx.writeBuffer()
}

describe('SaaS China inventory Excel workbook', () => {
  it('omits blank and zero generic-template quantities as no inventory while defaulting the warehouse', async () => {
    const parsed = await parseSaasChinaInventoryWorkbook(await workbookBuffer([
      ['', 'SKU-1', '상품 A', '', '', '이름만 수정'],
      ['', 'SKU-0', '상품 0', '', 0, '재고 없음'],
      ['광저우창고', 'SKU-2', '상품 B', '레드', '1,250', '실사'],
    ]))

    expect(parsed.source).toBe('saas_china_inventory')
    expect(parsed.errors).toEqual([])
    expect(parsed.reportEmptyQuantityCellCount).toBe(2)
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        rowNumber: 4,
        inventoryId: null,
        warehouseCode: '광저우창고',
        sku: 'SKU-2',
        productName: '상품 B',
        optionName: '레드',
        optionKey: '레드',
        onHandQuantity: 1250,
        note: '실사',
      }),
    ])
  })

  it('flags invalid quantities and duplicate warehouse/SKU/option identities before preview', async () => {
    const parsed = await parseSaasChinaInventoryWorkbook(await workbookBuffer([
      ['중국창고', 'SKU-1', '상품 A', '', '수량없음'],
      ['중국창고', 'SKU-2', '상품 B', '블랙', '10'],
      ['중국창고', 'SKU-2', '상품 B', '블랙', '20'],
    ]))

    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, message: '현재고는 0 이상의 정수로 입력해주세요.' }),
      expect.objectContaining({ row: 3, message: '같은 중국창고·품목코드·옵션명 조합이 엑셀에 중복되어 있습니다.' }),
      expect.objectContaining({ row: 4, message: '같은 중국창고·품목코드·옵션명 조합이 엑셀에 중복되어 있습니다.' }),
    ]))
  })

  it('expands every positive inventory-status warehouse quantity and omits blank or zero cells', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('재고현황')
    sheet.addRow(['회사명 : 테이포프 / 20261023'])
    sheet.addRow([
      '품목코드', '품목명', '규격', '품목구분', '합계', '부품관리', '브랜드',
      '스마일배송(개인个人1688)', '원재료 창고', '중국발생비용 (中国产生费用)', '중국창고', '쿠팡',
    ])
    sheet.addRow(['SKU-CHINA', '중국창고 상품', '레드', '[상품]', 14, 2, '', '', '', '', 12, ''])
    sheet.addRow(['SKU-NO-CHANGE', '빈 중국창고', '블랙', '[상품]', 5, '', '', 5, '', '', '', ''])
    sheet.addRow(['SKU-ZERO', '0 재고', '화이트', '[상품]', 0, '', '', '', '', '', 0, ''])
    sheet.addRow(['합계', '', '', '', 17, '', '', 5, '', '', 12, ''])
    sheet.addRow(['20261023  오후 4:06:39'])

    const parsed = await parseSaasChinaInventoryWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed).toMatchObject({
      source: 'inventory_status_report',
      totalRows: 3,
      skippedRows: 2,
      reportEmptyQuantityCellCount: 18,
      errors: [],
    })
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        warehouseCode: '부품관리',
        sku: 'SKU-CHINA',
        productName: '중국창고 상품',
        optionName: '레드',
        itemCategory: '[상품]',
        onHandQuantity: 2,
      }),
      expect.objectContaining({
        rowNumber: 3,
        warehouseCode: DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE,
        sku: 'SKU-CHINA',
        productName: '중국창고 상품',
        optionName: '레드',
        itemCategory: '[상품]',
        onHandQuantity: 12,
      }),
      expect.objectContaining({
        rowNumber: 4,
        warehouseCode: '스마일배송(개인个人1688)',
        sku: 'SKU-NO-CHANGE',
        itemCategory: '[상품]',
        onHandQuantity: 5,
      }),
    ])
  })

  it('keeps malformed inventory-status data rows so a full snapshot is blocked instead of silently omitting them', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('재고현황')
    sheet.addRow(['회사명 : 테이포프 / 20261023'])
    sheet.addRow([
      '품목코드', '품목명', '규격', '품목구분', '합계', '부품관리', '브랜드',
      '스마일배송(개인个人1688)', '원재료 창고', '중국발생비용 (中国产生费用)', '중국창고', '쿠팡',
    ])
    sheet.addRow(['SKU-MISSING-NAME', '', '레드', '[상품]', 6, '', '', '', '', '', 6, ''])
    sheet.addRow(['합계', '', '', '', 6, '', '', '', '', '', 6, ''])
    sheet.addRow(['20261023  오후 4:06:39'])

    const parsed = await parseSaasChinaInventoryWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed).toMatchObject({
      source: 'inventory_status_report',
      totalRows: 1,
      skippedRows: 2,
      errors: [expect.objectContaining({ row: 3, message: '재고현황의 품목명을 입력해주세요.' })],
    })
    expect(parsed.rows).toEqual([expect.objectContaining({
      rowNumber: 3,
      sku: 'SKU-MISSING-NAME',
      productName: null,
      onHandQuantity: 6,
    })])
  })

  it('does not treat a similarly shaped workbook without the China warehouse report column as a full snapshot', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('재고현황처럼 보이는 파일')
    sheet.addRow(['품목코드', '품목명', '규격', '품목구분', '합계', '부품관리'])
    sheet.addRow(['SKU-OTHER', '다른 양식', '레드', '[상품]', 2, 2])

    await expect(parseSaasChinaInventoryWorkbook(await workbook.xlsx.writeBuffer()))
      .rejects.toThrow('엑셀에서 품목코드와 현재고 헤더를 찾을 수 없습니다.')
  })

  it('requires the China warehouse column to be a post-category quantity column before enabling a full snapshot', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('재고현황처럼 보이는 파일')
    sheet.addRow(['중국창고', '품목코드', '품목명', '규격', '품목구분', '합계', '부품관리'])
    sheet.addRow(['창고 메모', 'SKU-OTHER', '다른 양식', '레드', '[상품]', 2, 2])

    await expect(parseSaasChinaInventoryWorkbook(await workbook.xlsx.writeBuffer()))
      .rejects.toThrow('엑셀에서 품목코드와 현재고 헤더를 찾을 수 없습니다.')
  })

  it('creates an uploadable empty template and exports the current list as a warehouse-column snapshot', async () => {
    const template = await exportSaasChinaInventoryTemplateWorkbook()
    const templateWorkbook = new ExcelJS.Workbook()
    await templateWorkbook.xlsx.load(template as unknown as ExcelJS.Buffer)
    expect(templateWorkbook.worksheets.map((sheet) => sheet.name)).toEqual(['SaaS 중국재고', '작성안내'])
    expect(templateWorkbook.getWorksheet('작성안내')?.getCell('B5').text).toContain('재고 식별키')
    expect(await parseSaasChinaInventoryWorkbook(template)).toMatchObject({ rows: [], errors: [] })

    const current = await exportSaasChinaInventoryWorkbook([
      {
        id: '11111111-1111-4111-8111-111111111111',
        warehouseCode: '중국창고',
        sku: 'SKU-3',
        productName: '상품 C',
        optionName: null,
        itemCategory: '[상품]',
        onHandQuantity: 12,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        warehouseCode: '스마일배송(개인个人1688)',
        sku: 'SKU-3',
        productName: '상품 C',
        optionName: null,
        itemCategory: '[상품]',
        onHandQuantity: 3,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        warehouseCode: '테스트창고',
        sku: 'SKU-4',
        productName: '원재료 D',
        optionName: '소',
        itemCategory: '[원재료]',
        onHandQuantity: 4,
      },
    ])
    const currentWorkbook = new ExcelJS.Workbook()
    await currentWorkbook.xlsx.load(current as unknown as ExcelJS.Buffer)
    const sheet = currentWorkbook.getWorksheet('재고현황')
    expect(sheet).toBeDefined()
    const inventoryStatusSheet = sheet!
    const headerValues = inventoryStatusSheet.getRow(1).values
    expect(Array.isArray(headerValues) ? headerValues.slice(1) : []).toEqual([
      ...SAAS_CHINA_INVENTORY_STATUS_HEADERS,
      ...SAAS_CHINA_INVENTORY_STATUS_WAREHOUSE_CODES,
      '테스트창고',
    ])
    expect(inventoryStatusSheet.getCell('E2').value).toBe(4)
    expect(inventoryStatusSheet.getCell('M2').value).toBe(4)
    expect(inventoryStatusSheet.getCell('E3').value).toBe(15)
    expect(inventoryStatusSheet.getCell('H3').value).toBe(3)
    expect(inventoryStatusSheet.getCell('K3').value).toBe(12)
    const parsed = await parseSaasChinaInventoryWorkbook(current)
    expect(parsed.source).toBe('inventory_status_report')
    expect(parsed.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        warehouseCode: '스마일배송(개인个人1688)',
        sku: 'SKU-3',
        itemCategory: '[상품]',
        onHandQuantity: 3,
      }),
      expect.objectContaining({
        warehouseCode: '중국창고',
        sku: 'SKU-3',
        itemCategory: '[상품]',
        onHandQuantity: 12,
      }),
      expect.objectContaining({
        warehouseCode: '테스트창고',
        sku: 'SKU-4',
        itemCategory: '[원재료]',
        onHandQuantity: 4,
      }),
    ]))
    expect(saasChinaInventoryExportFilename(new Date('2026-10-22T15:30:00.000Z'))).toBe('SaaS_중국재고_현재목록_20261023.xlsx')
  })

  it('rejects workbooks with more than 1,000 data rows before they can hold a long workspace lock', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('재고')
    sheet.addRow([...SAAS_CHINA_INVENTORY_EXCEL_HEADERS])
    sheet.getCell('B1002').value = 'OVER-LIMIT'
    sheet.getCell('E1002').value = 1

    const parsed = await parseSaasChinaInventoryWorkbook(await workbook.xlsx.writeBuffer())
    expect(parsed.errors).toEqual([expect.objectContaining({
      row: 1002,
      message: '엑셀은 1,000행 이하만 업로드할 수 있습니다. 1행을 확인해주세요.',
    })])
  })

  it('blocks an inventory-status report that expands beyond 1,000 warehouse inventory rows', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('재고현황')
    sheet.addRow([
      '품목코드', '품목명', '규격', '품목구분', '합계', '부품관리', '브랜드',
      '스마일배송(개인个人1688)', '원재료 창고', '중국발생비용 (中国产生费用)', '중국창고', '쿠팡',
    ])
    for (let index = 0; index < 143; index += 1) {
      sheet.addRow([`SKU-${index}`, `상품 ${index}`, '', '[상품]', 7, 1, 1, 1, 1, 1, 1, 1])
    }

    const parsed = await parseSaasChinaInventoryWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed.rows).toHaveLength(1_001)
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: '재고현황 파일은 1,000개 재고 행 이하만 업로드할 수 있습니다. 1개 항목을 확인해주세요.',
      }),
    ]))
  })
})
