import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'

import { exportToCarrierExcel } from '@/lib/shipping/excel/export'
import { exportOrdersToExcel } from '@/lib/shipping/excel/order-export'
import { generateCjExcel } from '@/lib/shipping/excel/cj-export'
import { generateDaesinExcel } from '@/lib/shipping/excel/daesin-export'
import { generateKyungdongExcel } from '@/lib/shipping/excel/kyungdong-export'
import { COMBINED_SHIPMENT_FILL_ARGB } from '@/lib/shipping/excel/combined-fill'
import type { CarrierTemplate } from '@/lib/shipping/types'

function fillArgb(row: ExcelJS.Row, columnIndex = 1): string | undefined {
  const fill = row.getCell(columnIndex).fill
  if (!fill || fill.type !== 'pattern') return undefined
  return fill.fgColor?.argb
}

describe('combined shipment Excel row fill', () => {
  it('colors combined shipment rows in carrier template downloads', async () => {
    const template: CarrierTemplate = {
      id: 'template-1',
      carrierId: 'CJGLS',
      name: 'Carrier',
      userId: 'user-1',
      isDefault: true,
      columns: [
        { header: 'Order', field: 'orderId', width: 15, required: true },
        { header: 'Product', field: 'productName', width: 20, required: true },
      ],
    }

    const buffer = await exportToCarrierExcel(
      [
        { orderId: 'A-1', productName: 'First', shipmentGroupId: 'group-a' },
        { orderId: 'B-1', productName: 'Single' },
        { orderId: 'A-2', productName: 'Second', shipmentGroupId: 'group-b' },
      ],
      template,
    )

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const sheet = workbook.worksheets[0]

    expect(fillArgb(sheet.getRow(2))).toBe(COMBINED_SHIPMENT_FILL_ARGB)
    expect(fillArgb(sheet.getRow(4))).toBe(COMBINED_SHIPMENT_FILL_ARGB)
    expect(fillArgb(sheet.getRow(3))).toBeUndefined()
    expect(fillArgb(sheet.getRow(2), 2)).toBe(fillArgb(sheet.getRow(2)))
  })

  it('colors combined shipment rows in selected order downloads', async () => {
    const buffer = await exportOrdersToExcel(
      [
        { orderId: 'A-1', productName: 'First', shipmentGroupId: 'group-a' },
        { orderId: 'B-1', productName: 'Single' },
      ],
      [
        { field: 'orderId', label: 'Order' },
        { field: 'productName', label: 'Product' },
      ],
    )

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const sheet = workbook.worksheets[0]

    expect(fillArgb(sheet.getRow(2))).toBe(COMBINED_SHIPMENT_FILL_ARGB)
    expect(fillArgb(sheet.getRow(3))).toBeUndefined()
  })

  it('colors same recipient and address rows even without a saved shipment group', async () => {
    const template: CarrierTemplate = {
      id: 'template-1',
      carrierId: 'CJGLS',
      name: 'Carrier',
      userId: 'user-1',
      isDefault: true,
      columns: [
        { header: 'Order', field: 'marketplaceOrderId', width: 15, required: true },
        { header: 'Recipient', field: 'recipientName', width: 15, required: true },
      ],
    }

    const rows = [
      {
        orderId: 'id-1',
        marketplaceOrderId: 'A-1',
        recipientName: '김테스트',
        shippingAddress: { zipCode: '12345', address1: '서울시 테스트로', address2: '101호' },
      },
      {
        orderId: 'id-2',
        marketplaceOrderId: 'A-2',
        recipientName: '김테스트',
        shippingAddress: { zipCode: '12345', address1: '서울시 테스트로', address2: '101호' },
      },
      {
        orderId: 'id-3',
        marketplaceOrderId: 'A-3',
        recipientName: '다른사람',
        shippingAddress: { zipCode: '99999', address1: '부산시', address2: '' },
      },
    ]

    const buffer = await exportToCarrierExcel(rows, template)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const sheet = workbook.worksheets[0]

    expect(fillArgb(sheet.getRow(2))).toBe(COMBINED_SHIPMENT_FILL_ARGB)
    expect(fillArgb(sheet.getRow(3))).toBe(COMBINED_SHIPMENT_FILL_ARGB)
    expect(fillArgb(sheet.getRow(4))).toBeUndefined()
  })

  it('colors same recipient and address rows in dedicated carrier downloads', async () => {
    const cjBuffer = await generateCjExcel([
      {
        orderId: 'id-1',
        marketplaceOrderId: 'A-1',
        recipientName: '김테스트',
        recipientPhone: '010',
        recipientAddress: '12345 서울시 테스트로 101호',
        productName: '상품1',
        quantity: 1,
        senderName: '',
        senderPhone: '',
        senderAddress: '',
      },
      {
        orderId: 'id-2',
        marketplaceOrderId: 'A-2',
        recipientName: '김테스트',
        recipientPhone: '010',
        recipientAddress: '12345 서울시 테스트로 101호',
        productName: '상품2',
        quantity: 1,
        senderName: '',
        senderPhone: '',
        senderAddress: '',
      },
    ])
    const daesinBuffer = await generateDaesinExcel([
      {
        orderId: 'id-1',
        marketplaceOrderId: 'A-1',
        recipientName: '김테스트',
        recipientPhone: '010',
        recipientAddress: '12345 서울시 테스트로 101호',
        productName: '상품1',
        quantity: 1,
        senderName: '',
        senderPhone: '',
      },
      {
        orderId: 'id-2',
        marketplaceOrderId: 'A-2',
        recipientName: '김테스트',
        recipientPhone: '010',
        recipientAddress: '12345 서울시 테스트로 101호',
        productName: '상품2',
        quantity: 1,
        senderName: '',
        senderPhone: '',
      },
    ])
    const kyungdongBuffer = await generateKyungdongExcel([
      {
        orderId: 'id-1',
        marketplaceOrderId: 'A-1',
        recipientName: '김테스트',
        recipientPhone: '010',
        recipientAddress: '서울시 테스트로',
        recipientDetailAddress: '101호',
        recipientZipCode: '12345',
        productName: '상품1',
        quantity: 1,
        senderName: '',
        senderPhone: '',
      },
      {
        orderId: 'id-2',
        marketplaceOrderId: 'A-2',
        recipientName: '김테스트',
        recipientPhone: '010',
        recipientAddress: '서울시 테스트로',
        recipientDetailAddress: '101호',
        recipientZipCode: '12345',
        productName: '상품2',
        quantity: 1,
        senderName: '',
        senderPhone: '',
      },
    ])

    for (const buffer of [cjBuffer, daesinBuffer, kyungdongBuffer]) {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
      const sheet = workbook.worksheets[0]

      expect(fillArgb(sheet.getRow(2))).toBe(COMBINED_SHIPMENT_FILL_ARGB)
      expect(fillArgb(sheet.getRow(3))).toBe(COMBINED_SHIPMENT_FILL_ARGB)
    }
  })
})
