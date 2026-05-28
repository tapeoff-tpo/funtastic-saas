import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'

import { exportToCarrierExcel } from '@/lib/shipping/excel/export'
import { exportOrdersToExcel } from '@/lib/shipping/excel/order-export'
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
        { orderId: 'A-2', productName: 'Second', shipmentGroupId: 'group-a' },
      ],
      template,
    )

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    const sheet = workbook.worksheets[0]

    expect(fillArgb(sheet.getRow(2))).toBeTruthy()
    expect(fillArgb(sheet.getRow(2))).toBe(fillArgb(sheet.getRow(4)))
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

    expect(fillArgb(sheet.getRow(2))).toBeTruthy()
    expect(fillArgb(sheet.getRow(3))).toBeUndefined()
  })
})
