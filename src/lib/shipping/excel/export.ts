/**
 * Carrier-specific Excel export with styled headers.
 *
 * Generates formatted Excel files matching Korean carrier template layouts.
 * Server-side only. Uses ExcelJS for workbook generation.
 */

import ExcelJS from 'exceljs'
import { PassThrough } from 'node:stream'
import type { CarrierTemplate } from '../types'
import { fillWholeRow, getCombinedShipmentFill, getRepeatedCombinedKeys, shouldFillCombinedShipmentRow } from './combined-fill'

/**
 * Resolve a dot-notation path on an object.
 * e.g., getNestedValue(order, 'shippingAddress.zipCode') -> '06234'
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE0E0E0' },
}

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}

function normalizeCombinedKeyPart(value: unknown): string {
  return String(value ?? '').trim().replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
}

function getTrackingCombinedKeys(orders: Record<string, unknown>[]): Set<string> {
  const counts = new Map<string, number>()
  for (const order of orders) {
    const trackingNumber = normalizeCombinedKeyPart(getNestedValue(order, 'trackingNumber'))
    if (!trackingNumber) continue
    const carrierName = normalizeCombinedKeyPart(getNestedValue(order, 'carrierName'))
    const key = `${carrierName}::${trackingNumber}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([key]) => key),
  )
}

function getAddressCombinedKeys(orders: Record<string, unknown>[]): Set<string> {
  const ordersByKey = new Map<string, Set<string>>()
  for (const order of orders) {
    const recipientName = normalizeCombinedKeyPart(getNestedValue(order, 'recipientName'))
    if (!recipientName) continue
    const addressValue = getNestedValue(order, 'shippingAddress')
    const address = addressValue && typeof addressValue === 'object'
      ? [
          getNestedValue(order, 'shippingAddress.zipCode'),
          getNestedValue(order, 'shippingAddress.address1'),
          getNestedValue(order, 'shippingAddress.address2'),
        ].map(normalizeCombinedKeyPart).join('')
      : normalizeCombinedKeyPart(getNestedValue(order, 'recipientAddress'))
    if (!address) continue

    const key = `${recipientName}::${address}`
    const orderSet = ordersByKey.get(key) ?? new Set<string>()
    orderSet.add(String(getNestedValue(order, 'marketplaceOrderId') || getNestedValue(order, 'orderId') || ''))
    ordersByKey.set(key, orderSet)
  }

  return new Set(
    [...ordersByKey.entries()]
      .filter(([, orderSet]) => orderSet.size >= 2)
      .map(([key]) => key),
  )
}

function isCombinedExportRow(order: Record<string, unknown>, trackingCombinedKeys: Set<string>): boolean {
  if (getCombinedShipmentFill(order.shipmentGroupId)) return true
  if (order.isCombinedShipment === true) return true

  const trackingNumber = normalizeCombinedKeyPart(getNestedValue(order, 'trackingNumber'))
  if (!trackingNumber) return false
  const carrierName = normalizeCombinedKeyPart(getNestedValue(order, 'carrierName'))
  return trackingCombinedKeys.has(`${carrierName}::${trackingNumber}`)
}

function isAddressCombinedExportRow(order: Record<string, unknown>, addressCombinedKeys: Set<string>): boolean {
  const recipientName = normalizeCombinedKeyPart(getNestedValue(order, 'recipientName'))
  if (!recipientName) return false
  const addressValue = getNestedValue(order, 'shippingAddress')
  const address = addressValue && typeof addressValue === 'object'
    ? [
        getNestedValue(order, 'shippingAddress.zipCode'),
        getNestedValue(order, 'shippingAddress.address1'),
        getNestedValue(order, 'shippingAddress.address2'),
      ].map(normalizeCombinedKeyPart).join('')
    : normalizeCombinedKeyPart(getNestedValue(order, 'recipientAddress'))
  if (!address) return false
  return addressCombinedKeys.has(`${recipientName}::${address}`)
}

function populateCarrierWorkbook(
  workbook: ExcelJS.Workbook,
  orders: Record<string, unknown>[],
  template: CarrierTemplate,
): void {
  const worksheet = workbook.addWorksheet(template.name)

  // Use index-based unique keys because multiple template columns can point to the same source field.
  worksheet.columns = template.columns.map((col, idx) => ({
    header: col.header,
    key: `c${idx}`,
    width: col.width,
  }))

  const headerRow = worksheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = THIN_BORDER
  })

  const trackingCombinedKeys = getTrackingCombinedKeys(orders)
  const addressCombinedKeys = getAddressCombinedKeys(orders)
  const combinedKeys = getRepeatedCombinedKeys(orders)

  for (const order of orders) {
    const rowData: Record<string, unknown> = {}
    template.columns.forEach((col, idx) => {
      const key = `c${idx}`
      if (col.fixedValue !== undefined && col.fixedValue !== '') {
        rowData[key] = col.fixedValue
      } else if (col.extraFields && col.extraFields.length > 0) {
        const parts = [col.field, ...col.extraFields]
          .map((field) => getNestedValue(order, field))
          .filter((value) => value !== undefined && value !== null && value !== '')
          .map((value) => String(value))
        rowData[key] = parts.join(col.joinSeparator ?? ' ')
      } else {
        rowData[key] = getNestedValue(order, col.field)
      }
    })

    const row = worksheet.addRow(rowData)
    if (
      isCombinedExportRow(order, trackingCombinedKeys)
      || isAddressCombinedExportRow(order, addressCombinedKeys)
      || shouldFillCombinedShipmentRow(order, combinedKeys)
    ) {
      fillWholeRow(row, template.columns.length, getCombinedShipmentFill('combined')!)
    }
  }
}

export async function exportToCarrierExcel(
  orders: Record<string, unknown>[],
  template: CarrierTemplate,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  populateCarrierWorkbook(workbook, orders, template)
  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer as ArrayBuffer)
}

export function exportToCarrierExcelStream(
  orders: Record<string, unknown>[],
  template: CarrierTemplate,
): ReadableStream<Uint8Array> {
  const passThrough = new PassThrough()
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      passThrough.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk))
      })
      passThrough.on('end', () => controller.close())
      passThrough.on('error', (error) => controller.error(error))
    },
    cancel() {
      passThrough.destroy()
    },
  })

  void (async () => {
    try {
      const workbook = new ExcelJS.Workbook()
      populateCarrierWorkbook(workbook, orders, template)
      await workbook.xlsx.write(passThrough)
      passThrough.end()
    } catch (error) {
      passThrough.destroy(error instanceof Error ? error : new Error(String(error)))
    }
  })()

  return readable
}
