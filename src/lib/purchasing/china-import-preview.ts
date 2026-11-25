import type { ImportDocumentEditCells } from './china-import-editing'
import ExcelJS from 'exceljs'

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const color = (value?: Partial<ExcelJS.Color>) => value?.argb && /^[0-9a-f]{8}$/i.test(value.argb) ? `#${value.argb.slice(2)}` : undefined

/** Render the actual exported worksheet, preserving its cells, merges and widths. */
export async function renderChinaImportPreview(buffer: Buffer, editCells: ImportDocumentEditCells = {}) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  const printEnd = sheet.pageSetup.printArea?.match(/\$?([A-Z]+)\$?(\d+)$/)
  const endRow = printEnd ? Number(printEnd[2]) : sheet.rowCount
  const printEndColumn = printEnd ? [...printEnd[1]].reduce((sum, character) => sum * 26 + character.charCodeAt(0) - 64, 0) : 24
  const endColumn = Math.max(printEndColumn, sheet.getCell('Y18').value ? 25 : 0)
  const merged = new Map<string, { rows: number; columns: number }>()
  const hidden = new Set<string>()
  for (const range of sheet.model.merges) {
    const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)!
    const column = (letters: string) => [...letters].reduce((sum, character) => sum * 26 + character.charCodeAt(0) - 64, 0)
    const left = column(match[1]), top = Number(match[2]), right = column(match[3]), bottom = Number(match[4])
    merged.set(`${top}:${left}`, { rows: bottom - top + 1, columns: right - left + 1 })
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) if (row !== top || col !== left) hidden.add(`${row}:${col}`)
  }
  let rows = ''
  for (let rowNo = 1; rowNo <= endRow; rowNo++) {
    const row = sheet.getRow(rowNo)
    if (row.hidden) continue
    let cells = ''
    for (let col = 1; col <= endColumn; col++) {
      if (hidden.has(`${rowNo}:${col}`)) continue
      const cell = row.getCell(col)
      let span = merged.get(`${rowNo}:${col}`)
      // Excel lets header text extend across neighboring empty cells. Give that
      // text the same space in HTML without changing the workbook's real merges.
      if (!span && rowNo < 18 && (cell.value != null || editCells[cell.address]) && !cell.alignment?.wrapText) {
        let right = col
        while (right < printEndColumn && !row.getCell(right).border?.right?.style && !row.getCell(right + 1).border?.left?.style && row.getCell(right + 1).value == null && !merged.has(`${rowNo}:${right + 1}`) && !hidden.has(`${rowNo}:${right + 1}`)) right++
        if (right > col) {
          span = { rows: 1, columns: right - col + 1 }
          for (let next = col + 1; next <= right; next++) hidden.add(`${rowNo}:${next}`)
        }
      }
      const style: string[] = ['padding:2px 3px', 'vertical-align:middle', 'box-sizing:border-box', 'font-size:10pt', `text-align:${cell.alignment?.horizontal === 'center' ? 'center' : cell.alignment?.horizontal === 'right' ? 'right' : 'left'}`]
      style.push(`white-space:${cell.alignment?.wrapText ? 'pre-wrap' : 'pre'}`)
      if (col === 25) style.push('background:#f8fafc', 'white-space:pre-wrap', 'border-left:1px solid #cbd5e1')
      if (cell.font?.bold) style.push('font-weight:bold')
      if (cell.font?.size) style.push(`font-size:${Number(cell.font.size)}pt`)
      if (color(cell.font?.color)) style.push(`color:${color(cell.font.color)}`)
      if (cell.fill?.type === 'pattern' && color(cell.fill.fgColor)) style.push(`background:${color(cell.fill.fgColor)}`)
      for (const side of ['top', 'bottom', 'left', 'right'] as const) if (cell.border?.[side]?.style) style.push(`border-${side}:${cell.border[side]?.style === 'double' ? '3px double' : '1px solid'} ${color(cell.border[side]?.color) ?? '#333'}`)
      let value: unknown = cell.value
      if (value && typeof value === 'object' && 'result' in value) value = value.result ?? ''
      else if (value && typeof value === 'object' && 'richText' in value) value = (value.richText as ExcelJS.RichText[]).map((part) => part.text).join('')
      else if (value && typeof value === 'object' && 'text' in value) value = value.text
      if (value instanceof Date) value = value.toISOString().slice(0, 10)
      else if (typeof value === 'number') {
        const decimals = cell.numFmt?.match(/\.([0#]+)/)?.[1].length ?? (cell.numFmt === '#,##0' || cell.numFmt === '0' || Number.isInteger(value) ? 0 : 4)
        value = Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: Math.min(decimals, 6), maximumFractionDigits: Math.min(decimals, 6) }) : ''
      } else if (value && typeof value === 'object') value = ''
      const editors = editCells[cell.address]
      const content = editors ? editors.map((field) => `<input data-edit-key="${escape(field.key)}" aria-label="${escape(field.label)}" type="${field.type ?? 'text'}" value="${escape(field.value)}" ${field.type === 'number' ? 'min="0" step="0.01"' : 'maxlength="500"'} style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:3px;box-sizing:border-box;min-width:0;width:${editors.length > 1 ? (field.type === 'date' ? '49%' : '50%') : '100%'};font:inherit;color:inherit;padding:2px 3px" />`).join(' ') : escape(value)
      cells += `<td${span ? ` rowspan="${span.rows}" colspan="${span.columns}"` : ''} style="${style.join(';')}">${content}</td>`
    }
    rows += `<tr style="height:${Number(row.height ?? 15)}pt">${cells}</tr>`
  }
  const sheetWidth = Array.from({ length: endColumn }, (_, index) => Math.round((sheet.getColumn(index + 1).width ?? 8.43) * 7 + 5)).reduce((sum, width) => sum + width, 0)
  const columns = Array.from({ length: endColumn }, (_, index) => `<col style="width:${Math.round((sheet.getColumn(index + 1).width ?? 8.43) * 7 + 5)}px">`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>:root{--sheet-zoom:1}body{margin:0;padding:20px;background:#e5e7eb;color:#111;font-family:Dotum,Arial,sans-serif}table{width:${sheetWidth}px;zoom:var(--sheet-zoom);table-layout:fixed;border-collapse:collapse;background:white;box-shadow:0 1px 8px #0002}td{padding:2px 3px;vertical-align:middle;box-sizing:border-box;font-size:10pt} @media print{body{padding:0;background:white}table{box-shadow:none}}</style></head><body><table style="width:${sheetWidth}px;table-layout:fixed;border-collapse:collapse;background:white" aria-label="INVOICE AND PACKING LIST">${columns}<tbody>${rows}</tbody></table></body></html>`
}
