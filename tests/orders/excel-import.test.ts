import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parseOrderExcel } from '@/lib/orders/excel-import'

describe('parseOrderExcel', () => {
  it('still reads product unique id when a custom template maps shipping item number', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('orders')
    sheet.addRow([
      '주문번호',
      '출고상품번호',
      '상품고유번호',
      '주문자명',
      '수령자명',
      '수령자주소',
      '주문일시',
      '상품명',
      '수량',
      '금액(원)',
    ])
    sheet.addRow([
      'O-1',
      'SHIP-ITEM-001',
      'PRODUCT-UNIQUE-001',
      '구매자',
      '수령자',
      '서울시',
      '2026-05-29 10:00:00',
      '상품',
      1,
      1000,
    ])

    const buffer = await workbook.xlsx.writeBuffer()
    const result = await parseOrderExcel(buffer, [
      { field: 'orderNumber', excelColumn: '주문번호' },
      { field: 'marketplaceItemId', excelColumn: '출고상품번호' },
      { field: 'buyerName', excelColumn: '주문자명' },
      { field: 'recipientName', excelColumn: '수령자명' },
      { field: 'recipientAddress', excelColumn: '수령자주소' },
      { field: 'orderedAt', excelColumn: '주문일시' },
      { field: 'productName', excelColumn: '상품명' },
      { field: 'quantity', excelColumn: '수량' },
      { field: 'totalAmount', excelColumn: '금액(원)' },
    ])

    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({
      marketplaceItemId: 'SHIP-ITEM-001',
      sku: 'PRODUCT-UNIQUE-001',
    })
  })
})
