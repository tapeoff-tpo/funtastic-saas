import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { createDiscontinuedProductTemplate, parseDiscontinuedProductFile } from './discontinued-product-file'

describe('parseDiscontinuedProductFile', () => {
  it('reads a partial action list and keeps the last duplicate SKU action', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('단종상품')
    sheet.addRow(['품목코드', '품목명', '단종여부', '단종사유', '단종일', '비고'])
    sheet.addRow(['111111-0001', '첫 상품', '단종', '공급 종료', '2026-09-04', '남은 재고 판매'])
    sheet.addRow(['222222-0001', '둘째 상품', '해제', '', '', '다시 발주 가능'])
    sheet.addRow(['111111-0001', '첫 상품', '해제', '', '', '공급 재개'])

    const fileBuffer = await workbook.xlsx.writeBuffer()
    const parsed = await parseDiscontinuedProductFile({
      fileName: '단종상품.xlsx',
      fileBuffer: fileBuffer as ArrayBuffer,
    })

    expect(parsed.totalDataRows).toBe(3)
    expect(parsed.duplicateSkus).toEqual(['111111-0001'])
    expect(parsed.actions).toEqual([
      expect.objectContaining({ sku: '111111-0001', action: 'active', note: '공급 재개' }),
      expect.objectContaining({ sku: '222222-0001', action: 'active', note: '다시 발주 가능' }),
    ])
  })

  it('requires a dedicated discontinued status column', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('단종상품')
    sheet.addRow(['품목코드', '품목명'])
    sheet.addRow(['111111-0001', '첫 상품'])

    const fileBuffer = await workbook.xlsx.writeBuffer()
    await expect(parseDiscontinuedProductFile({
      fileName: '잘못된양식.xlsx',
      fileBuffer: fileBuffer as ArrayBuffer,
    })).rejects.toThrow('"품목코드"와 "단종여부" 열')
  })

  it('shows the source row when a status value is invalid', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('단종상품')
    sheet.addRow(['품목코드', '단종여부'])
    sheet.addRow(['111111-0001', '확인필요'])

    const fileBuffer = await workbook.xlsx.writeBuffer()
    await expect(parseDiscontinuedProductFile({
      fileName: '상태오류.xlsx',
      fileBuffer: fileBuffer as ArrayBuffer,
    })).rejects.toThrow('2행 (확인필요)')
  })

  it('creates a blank template that can be uploaded without treating its guide as a product row', async () => {
    const template = await createDiscontinuedProductTemplate()
    const parsed = await parseDiscontinuedProductFile({
      fileName: '단종상품_로우데이터_양식.xlsx',
      fileBuffer: template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) as ArrayBuffer,
    })

    expect(parsed.totalDataRows).toBe(0)
    expect(parsed.actions).toEqual([])
  })
})
