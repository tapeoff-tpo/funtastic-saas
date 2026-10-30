import ExcelJS from 'exceljs'

const INVISIBLE_SPACES = /[\u200B-\u200D\u2060\uFEFF]/g
const isBlankText = (text: string) => text.replace(INVISIBLE_SPACES, '').trim() === ''

/** Excel treats literal empty strings as data. Clear their values before export
 * so Ctrl+Arrow and ISBLANK see real empty cells, while keeping styles and inputs.
 * Formulas, hyperlinks, zero and false remain meaningful values.
 */
export function clearBlankExcelCells(workbook: ExcelJS.Workbook) {
  let cleared = 0
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        // A merged child delegates its value to the master; never clear it separately.
        if (cell.type === ExcelJS.ValueType.Merge) return
        const value = cell.value
        const blank = typeof value === 'string'
          ? isBlankText(value)
          : value !== null && typeof value === 'object' && 'richText' in value
            && value.richText.every((run) => isBlankText(run.text))
        if (!blank) return
        cell.value = null
        cleared += 1
      })
    })
  })
  return cleared
}
