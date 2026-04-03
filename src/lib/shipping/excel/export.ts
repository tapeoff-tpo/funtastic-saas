/**
 * Carrier-specific Excel export with styled headers.
 *
 * Generates formatted Excel files matching Korean carrier template layouts.
 * Server-side only. Uses ExcelJS for workbook generation.
 */

import ExcelJS from 'exceljs'
import type { CarrierTemplate } from '../types'

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

/** Header style: bold white text on gray background with thin borders */
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

/**
 * Export orders to a carrier-specific Excel format.
 *
 * Creates a styled workbook with:
 * - Worksheet named after the template
 * - Columns sized per template definition
 * - Bold header row with gray background and borders
 * - Data rows populated by extracting field values using dot-notation
 */
export async function exportToCarrierExcel(
  orders: Record<string, unknown>[],
  template: CarrierTemplate,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(template.name)

  // Set columns from template
  worksheet.columns = template.columns.map((col) => ({
    header: col.header,
    key: col.field,
    width: col.width,
  }))

  // Style header row
  const headerRow = worksheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.border = THIN_BORDER
  })

  // Add data rows
  for (const order of orders) {
    const rowData: Record<string, unknown> = {}
    for (const col of template.columns) {
      rowData[col.field] = getNestedValue(order, col.field)
    }
    worksheet.addRow(rowData)
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
