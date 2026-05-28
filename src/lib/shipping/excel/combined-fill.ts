import type ExcelJS from 'exceljs'

const COMBINED_SHIPMENT_FILLS: ExcelJS.FillPattern[] = [
  'FFD8E4BC',
  'FFDAEEF3',
  'FFFCE4D6',
  'FFE4DFEC',
  'FFFFF2CC',
  'FFDDEBF7',
  'FFE2F0D9',
  'FFF4CCCC',
].map((argb) => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
}))

function hashText(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

export function getCombinedShipmentFill(groupId: unknown): ExcelJS.FillPattern | null {
  if (typeof groupId !== 'string' || groupId.length === 0) return null
  return COMBINED_SHIPMENT_FILLS[hashText(groupId) % COMBINED_SHIPMENT_FILLS.length]
}

export function fillWholeRow(row: ExcelJS.Row, columnCount: number, fill: ExcelJS.FillPattern): void {
  for (let index = 1; index <= columnCount; index += 1) {
    row.getCell(index).fill = fill
  }
}
