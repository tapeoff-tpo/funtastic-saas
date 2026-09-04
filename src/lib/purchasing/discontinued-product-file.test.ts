import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { createDiscontinuedProductTemplate, parseDiscontinuedProductFile } from './discontinued-product-file'

describe('parseDiscontinuedProductFile', () => {
  it('reads a simple SKU, product-name, option list and keeps duplicate SKUs once', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('단종상품')
    sheet.addRow(['품목코드', '품목명', '옵션'])
    sheet.addRow(['111111-0001', '첫 상품', '화이트'])
    sheet.addRow(['222222-0001', '둘째 상품', '블랙'])
    sheet.addRow(['111111-0001', '첫 상품', '화이트'])

    const fileBuffer = await workbook.xlsx.writeBuffer()
    const parsed = await parseDiscontinuedProductFile({
      fileName: '단종상품.xlsx',
      fileBuffer: fileBuffer as ArrayBuffer,
    })

    expect(parsed.totalDataRows).toBe(3)
    expect(parsed.duplicateSkus).toEqual(['111111-0001'])
    expect(parsed.actions).toEqual([
      expect.objectContaining({ sku: '111111-0001', productName: '첫 상품', optionName: '화이트' }),
      expect.objectContaining({ sku: '222222-0001', productName: '둘째 상품', optionName: '블랙' }),
    ])
  })

  it('does not require a status column because every listed SKU is discontinued', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('단종상품')
    sheet.addRow(['품목코드', '품목명', '옵션'])
    sheet.addRow(['111111-0001', '첫 상품', '기본'])

    const fileBuffer = await workbook.xlsx.writeBuffer()
    await expect(parseDiscontinuedProductFile({
      fileName: '단종목록.xlsx',
      fileBuffer: fileBuffer as ArrayBuffer,
    })).resolves.toMatchObject({
      actions: [expect.objectContaining({ sku: '111111-0001' })],
    })
  })

  it('requires a product code column', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('단종상품')
    sheet.addRow(['품목명', '옵션'])
    sheet.addRow(['첫 상품', '기본'])

    const fileBuffer = await workbook.xlsx.writeBuffer()
    await expect(parseDiscontinuedProductFile({
      fileName: '잘못된양식.xlsx',
      fileBuffer: fileBuffer as ArrayBuffer,
    })).rejects.toThrow('"품목코드" 열')
  })

  it('creates a blank template that can be uploaded without treating its guide as a product row', async () => {
    const template = await createDiscontinuedProductTemplate()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(template as unknown as ExcelJS.Buffer)
    const header = workbook.worksheets[0]?.getRow(3)

    expect([
      header?.getCell(1).text,
      header?.getCell(2).text,
      header?.getCell(3).text,
    ]).toEqual(['품목코드', '품목명', '옵션'])

    const parsed = await parseDiscontinuedProductFile({
      fileName: '단종상품_로우데이터_양식.xlsx',
      fileBuffer: template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) as ArrayBuffer,
    })

    expect(parsed.totalDataRows).toBe(0)
    expect(parsed.actions).toEqual([])
  })
})
