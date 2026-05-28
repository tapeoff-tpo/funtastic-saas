import type ExcelJS from 'exceljs'

export const COMBINED_SHIPMENT_FILL_ARGB = 'FFD8E4BC'

const COMBINED_SHIPMENT_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: COMBINED_SHIPMENT_FILL_ARGB },
}

export function getCombinedShipmentFill(groupId: unknown): ExcelJS.FillPattern | null {
  if (typeof groupId !== 'string' || groupId.length === 0) return null
  return COMBINED_SHIPMENT_FILL
}

export function fillWholeRow(row: ExcelJS.Row, columnCount: number, fill: ExcelJS.FillPattern): void {
  for (let index = 1; index <= columnCount; index += 1) {
    row.getCell(index).fill = fill
  }
}
