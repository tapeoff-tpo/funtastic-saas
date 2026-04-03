/**
 * General order list Excel export with configurable columns.
 *
 * Supports user-selected column layout from AVAILABLE_ORDER_FIELDS.
 * Server-side only. Uses ExcelJS for workbook generation.
 */

import ExcelJS from 'exceljs'
import { getNestedValue } from './export'
import type { OrderFieldDef } from './templates'

/** Header style matching carrier export for consistency */
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
 * Estimate column width based on field type.
 */
function estimateWidth(field: string): number {
  if (field.includes('address') || field.includes('Address')) return 30
  if (field.includes('Name') || field.includes('name')) return 15
  if (field.includes('Phone') || field.includes('phone')) return 15
  if (field === 'quantity') return 8
  if (field.includes('Amount') || field.includes('Price')) return 12
  return 15
}

/**
 * Export orders to Excel with user-selected columns.
 *
 * Creates a styled workbook with:
 * - Columns from the user's selection (subset of AVAILABLE_ORDER_FIELDS)
 * - Bold header row with gray background and borders
 * - Auto-estimated column widths
 * - Data rows populated via dot-notation field extraction
 */
export async function exportOrdersToExcel(
  orders: Record<string, unknown>[],
  columns: OrderFieldDef[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('주문목록')

  // Set columns
  worksheet.columns = columns.map((col) => ({
    header: col.label,
    key: col.field,
    width: estimateWidth(col.field),
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
    for (const col of columns) {
      rowData[col.field] = getNestedValue(order, col.field)
    }
    worksheet.addRow(rowData)
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
