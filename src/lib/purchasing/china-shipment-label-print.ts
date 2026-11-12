import type ExcelJS from 'exceljs'
import { createChinaOutboundShipmentLabelWorkbook, type ChinaOutboundShipmentLabelDetail, type ChinaOutboundShipmentLabelWorkbookOptions } from './china-outbound-shipment-labels'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const lines = (value: unknown) => escapeHtml(value).replace(/\r?\n/g, '<br>')

function fontStyle(font: Partial<ExcelJS.Font> = {}) {
  return `${font.size ? `font-size:${Number(font.size)}pt;` : ''}${font.bold ? 'font-weight:bold;' : ''}${font.name ? `font-family:${escapeHtml(font.name)},sans-serif;` : ''}`
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value
  if (value && typeof value === 'object' && 'richText' in value) return value.richText.map((run) => `<span style="${fontStyle(run.font)}">${lines(run.text)}</span>`).join('')
  if (typeof value === 'number') return `${value.toLocaleString('en-US')}${cell.numFmt?.includes(' PC') ? ' PC' : ''}`
  return lines(cell.text)
}

function columnNumber(letters: string) { return [...letters].reduce((result, letter) => result * 26 + letter.charCodeAt(0) - 64, 0) }

function labelTable(sheet: ExcelJS.Worksheet) {
  const merges = new Map<string, { rows: number; columns: number }>()
  for (const range of sheet.model.merges) {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range)
    if (!match) continue
    merges.set(`${match[1]}${match[2]}`, { rows: Number(match[4]) - Number(match[2]) + 1, columns: columnNumber(match[3]) - columnNumber(match[1]) + 1 })
  }
  const width = sheet.columns.reduce((sum, column) => sum + (column.width ?? 12) * 7, 0)
  const height = Array.from({ length: sheet.rowCount }, (_, index) => (sheet.getRow(index + 1).height ?? 20) * 4 / 3).reduce((sum, value) => sum + value, 0)
  const columns = sheet.columns.map((column) => `<col style="width:${(column.width ?? 12) * 7}px">`).join('')
  const rows = Array.from({ length: sheet.rowCount }, (_, index) => {
    const row = sheet.getRow(index + 1)
    let cells = ''
    for (let column = 1; column <= sheet.columnCount; column++) {
      const cell = row.getCell(column)
      if (cell.isMerged && cell.master.address !== cell.address) continue
      const merge = merges.get(cell.address)
      const fill = cell.fill?.type === 'pattern' && cell.fill.fgColor?.argb
      const background = fill && /^[A-Fa-f0-9]{8}$/.test(fill) ? `background:#${fill.slice(2)};` : ''
      const alignment = ['left', 'center', 'right'].includes(cell.alignment?.horizontal ?? '') ? cell.alignment.horizontal : 'left'
      const edges = (['top', 'bottom', 'left', 'right'] as const).filter((edge) => cell.border?.[edge]?.style).map((edge) => `border-${edge}:1px solid #000;`).join('')
      cells += `<td${merge ? ` rowspan="${merge.rows}" colspan="${merge.columns}"` : ''} style="${fontStyle(cell.font)}${background}${edges}text-align:${alignment};">${cellText(cell)}</td>`
    }
    return `<tr style="height:${row.height ?? 20}pt">${cells}</tr>`
  }).join('')
  return `<section class="page" aria-label="${escapeHtml(sheet.name)}"><div class="canvas" style="width:${width}px;height:${height}px"><table style="width:${width}px;height:${height}px"><colgroup>${columns}</colgroup><tbody>${rows}</tbody></table></div></section>`
}

/** Render the exact label workbook, including its merged cells, Korean/Chinese
 * names and per-box locations, so Excel and direct printing stay in sync. */
export function renderChinaShipmentLabelPrint(detail: ChinaOutboundShipmentLabelDetail, options: ChinaOutboundShipmentLabelWorkbookOptions, nonce: string) {
  const workbook = createChinaOutboundShipmentLabelWorkbook(detail, options)
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(detail.shipment.shipmentNo)} · 쉽먼트 / 货运标签</title><style>
@page{size:A4 landscape;margin:5mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#e5e7eb;color:#000}.toolbar{padding:12px;text-align:center}.toolbar button{padding:8px 20px;cursor:pointer}.page{position:relative;width:287mm;height:200mm;margin:12px auto;background:white;overflow:hidden;break-after:page;page-break-after:always}.page:last-of-type{break-after:auto;page-break-after:auto}.canvas{position:absolute;transform-origin:top left}table{border-collapse:collapse;table-layout:fixed}td{padding:4px;vertical-align:middle;overflow-wrap:anywhere;white-space:normal;font-size:14pt}@media print{body{background:white}.toolbar{display:none}.page{margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><div class="toolbar"><button id="print">인쇄 / 打印</button></div>${workbook.worksheets.map(labelTable).join('')}<script nonce="${escapeHtml(nonce)}">
function fit(){document.querySelectorAll('.page').forEach(function(page){const canvas=page.querySelector('.canvas');canvas.style.transform='none';const table=canvas.querySelector('table');canvas.style.width=table.offsetWidth+'px';canvas.style.height=table.offsetHeight+'px';const scale=Math.min((page.clientWidth-1)/canvas.offsetWidth,(page.clientHeight-1)/canvas.offsetHeight);canvas.style.transform='scale('+scale+')';canvas.style.left=(page.clientWidth-canvas.offsetWidth*scale)/2+'px';canvas.style.top=(page.clientHeight-canvas.offsetHeight*scale)/2+'px'})}
document.getElementById('print').addEventListener('click',function(){fit();window.print()});window.addEventListener('beforeprint',fit);window.addEventListener('resize',fit);window.addEventListener('load',async function(){await document.fonts.ready;fit();window.print()});
</script></body></html>`
}
