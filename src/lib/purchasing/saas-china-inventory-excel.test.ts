import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE,
  exportSaasChinaInventoryTemplateWorkbook,
  exportSaasChinaInventoryWorkbook,
  parseSaasChinaInventoryWorkbook,
  saasChinaInventoryExportFilename,
  SAAS_CHINA_INVENTORY_EXCEL_HEADERS,
} from './saas-china-inventory-excel'

async function workbookBuffer(rows: Array<Array<string | number | null | undefined>>, headers = [...SAAS_CHINA_INVENTORY_EXCEL_HEADERS]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('재고')
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  return workbook.xlsx.writeBuffer()
}

describe('SaaS China inventory Excel workbook', () => {
  it('parses absolute on-hand targets while keeping a blank quantity nullable and defaulting the warehouse', async () => {
    const parsed = await parseSaasChinaInventoryWorkbook(await workbookBuffer([
      ['', 'SKU-1', '상품 A', '', '', '이름만 수정'],
      ['광저우창고', 'SKU-2', '상품 B', '레드', '1,250', '실사'],
    ]))

    expect(parsed.source).toBe('saas_china_inventory')
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        inventoryId: null,
        warehouseCode: DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE,
        sku: 'SKU-1',
        productName: '상품 A',
        optionName: null,
        optionKey: '',
        onHandQuantity: null,
        note: '이름만 수정',
      }),
      expect.objectContaining({
        rowNumber: 3,
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
      ['중국창고', 'SKU-1', '상품 A', '', '-1'],
      ['중국창고', 'SKU-2', '상품 B', '블랙', '10'],
      ['중국창고', 'SKU-2', '상품 B', '블랙', '20'],
    ]))

    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, message: '현재고는 0 이상의 정수로 입력해주세요.' }),
      expect.objectContaining({ row: 3, message: '같은 중국창고·품목코드·옵션명 조합이 엑셀에 중복되어 있습니다.' }),
      expect.objectContaining({ row: 4, message: '같은 중국창고·품목코드·옵션명 조합이 엑셀에 중복되어 있습니다.' }),
    ]))
  })

  it('reads a blank inventory-status 중국창고 quantity as zero and skips report totals', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('재고현황')
    sheet.addRow(['회사명 : 테이포프 / 20261023'])
    sheet.addRow([
      '품목코드', '품목명', '규격', '품목구분', '합계', '부품관리', '브랜드',
      '스마일배송(개인个人1688)', '원재료 창고', '중국발생비용 (中国产生费用)', '중국창고', '쿠팡',
    ])
    sheet.addRow(['SKU-CHINA', '중국창고 상품', '레드', '[상품]', 12, '', '', '', '', '', 12, ''])
    sheet.addRow(['SKU-NO-CHANGE', '빈 중국창고', '블랙', '[상품]', 5, '', '', 5, '', '', '', ''])
    sheet.addRow(['SKU-ZERO', '0 재고', '화이트', '[상품]', 0, '', '', '', '', '', 0, ''])
    sheet.addRow(['합계', '', '', '', 17, '', '', 5, '', '', 12, ''])
    sheet.addRow(['20261023  오후 4:06:39'])

    const parsed = await parseSaasChinaInventoryWorkbook(await workbook.xlsx.writeBuffer())

    expect(parsed).toMatchObject({
      source: 'inventory_status_report',
      totalRows: 3,
      skippedRows: 2,
      reportBlankQuantityRowCount: 1,
      errors: [],
    })
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        warehouseCode: DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE,
        sku: 'SKU-CHINA',
        productName: '중국창고 상품',
        optionName: '레드',
        onHandQuantity: 12,
      }),
      expect.objectContaining({
        rowNumber: 4,
        sku: 'SKU-NO-CHANGE',
        onHandQuantity: 0,
        reportBlankQuantity: true,
      }),
      expect.objectContaining({
        rowNumber: 5,
        warehouseCode: DEFAULT_SAAS_CHINA_INVENTORY_WAREHOUSE_CODE,
        sku: 'SKU-ZERO',
        optionName: '화이트',
        onHandQuantity: 0,
      }),
    ])
  })

  it('creates an uploadable empty template and exports the current list using the editable headers', async () => {
    const template = await exportSaasChinaInventoryTemplateWorkbook()
    const templateWorkbook = new ExcelJS.Workbook()
    await templateWorkbook.xlsx.load(template as unknown as ExcelJS.Buffer)
    expect(templateWorkbook.worksheets.map((sheet) => sheet.name)).toEqual(['SaaS 중국재고', '작성안내'])
    expect(templateWorkbook.getWorksheet('작성안내')?.getCell('B5').text).toContain('재고 식별키')
    expect(await parseSaasChinaInventoryWorkbook(template)).toMatchObject({ rows: [], errors: [] })

    const current = await exportSaasChinaInventoryWorkbook([{
      id: '11111111-1111-4111-8111-111111111111',
      warehouseCode: '중국창고',
      sku: 'SKU-3',
      productName: '상품 C',
      optionName: null,
      onHandQuantity: 12,
      reservedQuantity: 2,
      availableQuantity: 10,
      lastReceivedAt: new Date('2026-10-23T01:02:03.000Z'),
    }])
    const currentWorkbook = new ExcelJS.Workbook()
    await currentWorkbook.xlsx.load(current as unknown as ExcelJS.Buffer)
    const sheet = currentWorkbook.getWorksheet('SaaS 중국재고')
    expect(sheet?.getRow(1).values).toEqual(expect.arrayContaining([...SAAS_CHINA_INVENTORY_EXCEL_HEADERS]))
    expect(sheet?.getColumn(1).hidden).toBe(true)
    expect(sheet?.getCell('B2').fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'F2F2F2' } })
    expect(sheet?.getCell('D2').fill).toMatchObject({ type: 'pattern', fgColor: { argb: 'FFF2CC' } })
    const parsed = await parseSaasChinaInventoryWorkbook(current)
    expect(parsed.rows).toEqual([expect.objectContaining({
      inventoryId: '11111111-1111-4111-8111-111111111111',
      sku: 'SKU-3',
      onHandQuantity: 12,
    })])
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
})
