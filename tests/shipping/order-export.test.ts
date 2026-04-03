import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'

import { exportOrdersToExcel } from '@/lib/shipping/excel/order-export'

const testOrders = [
  {
    orderId: 'ORD-001',
    marketplaceOrderId: 'MKT-001',
    recipientName: '김철수',
    recipientPhone: '010-1234-5678',
    productName: '테스트 상품',
    quantity: 2,
    status: 'confirmed',
  },
  {
    orderId: 'ORD-002',
    marketplaceOrderId: 'MKT-002',
    recipientName: '이영희',
    recipientPhone: '010-9876-5432',
    productName: '다른 상품',
    quantity: 1,
    status: 'new',
  },
]

describe('exportOrdersToExcel', () => {
  it('generates Excel with user-selected columns only', async () => {
    const selectedColumns = [
      { field: 'orderId', label: '주문번호' },
      { field: 'recipientName', label: '수령인' },
      { field: 'productName', label: '상품명' },
    ]

    const buffer = await exportOrdersToExcel(testOrders as any[], selectedColumns)

    expect(buffer).toBeInstanceOf(Buffer)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const ws = wb.worksheets[0]

    // Only 3 selected columns
    expect(ws.columnCount).toBe(3)

    // Headers match selected columns
    const headerRow = ws.getRow(1)
    expect(headerRow.getCell(1).value).toBe('주문번호')
    expect(headerRow.getCell(2).value).toBe('수령인')
    expect(headerRow.getCell(3).value).toBe('상품명')

    // Data rows
    expect(ws.getRow(2).getCell(1).value).toBe('ORD-001')
    expect(ws.getRow(2).getCell(2).value).toBe('김철수')
    expect(ws.getRow(3).getCell(3).value).toBe('다른 상품')

    // Header styling
    expect(headerRow.getCell(1).font?.bold).toBe(true)
  })
})
