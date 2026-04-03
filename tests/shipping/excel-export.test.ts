import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'

import { exportToCarrierExcel } from '@/lib/shipping/excel/export'
import type { CarrierTemplate } from '@/lib/shipping/types'

const testTemplate: CarrierTemplate = {
  id: 'test-1',
  carrierId: 'CJGLS',
  name: 'CJ대한통운',
  userId: 'user-1',
  isDefault: true,
  columns: [
    { header: '수령인', field: 'recipientName', width: 15, required: true },
    { header: '수령인연락처', field: 'recipientPhone', width: 15, required: true },
    { header: '우편번호', field: 'shippingAddress.zipCode', width: 10, required: true },
    { header: '주소', field: 'shippingAddress.address1', width: 30, required: true },
    { header: '상품명', field: 'productName', width: 25, required: true },
    { header: '수량', field: 'quantity', width: 8, required: true },
  ],
}

const testOrders = [
  {
    recipientName: '김철수',
    recipientPhone: '010-1234-5678',
    shippingAddress: {
      zipCode: '06234',
      address1: '서울시 강남구 역삼동',
    },
    productName: '테스트 상품 A',
    quantity: 2,
  },
  {
    recipientName: '이영희',
    recipientPhone: '010-9876-5432',
    shippingAddress: {
      zipCode: '04539',
      address1: '서울시 중구 을지로',
    },
    productName: '테스트 상품 B',
    quantity: 1,
  },
]

describe('exportToCarrierExcel', () => {
  it('generates a workbook buffer with styled header row and correct column count', async () => {
    const buffer = await exportToCarrierExcel(testOrders as any[], testTemplate)

    expect(buffer).toBeInstanceOf(Buffer)
    expect(buffer.length).toBeGreaterThan(0)

    // Read back the generated Excel
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const ws = wb.worksheets[0]

    expect(ws.name).toBe('CJ대한통운')
    expect(ws.columnCount).toBe(6)

    // Check header row
    const headerRow = ws.getRow(1)
    expect(headerRow.getCell(1).value).toBe('수령인')
    expect(headerRow.getCell(2).value).toBe('수령인연락처')
    expect(headerRow.getCell(6).value).toBe('수량')

    // Check header styling (bold)
    expect(headerRow.getCell(1).font?.bold).toBe(true)
  })

  it('uses template columns for headers and populates data rows', async () => {
    const buffer = await exportToCarrierExcel(testOrders as any[], testTemplate)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const ws = wb.worksheets[0]

    // Data rows start at row 2
    expect(ws.getRow(2).getCell(1).value).toBe('김철수')
    expect(ws.getRow(2).getCell(3).value).toBe('06234')
    expect(ws.getRow(3).getCell(1).value).toBe('이영희')
    expect(ws.getRow(3).getCell(5).value).toBe('테스트 상품 B')
  })
})
