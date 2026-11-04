import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { createHash, randomUUID } from 'node:crypto'
import { createRegistrationRow, imageStem, LABEL_FIELD, money, rowFields, rowIssues, type RegistrationDraft, type RegistrationRow, type SavedFile, type TemplateInfo } from './model'

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return String(value.result ?? '')
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    if ('text' in value) return value.text
  }
  return String(value)
}

function templateInfo(workbook: ExcelJS.Workbook, id: string, name: string): TemplateInfo {
  const sheets = workbook.worksheets.filter((sheet) => sheet.name.startsWith('QF_')).map((sheet) => {
    const columns: TemplateInfo['sheets'][number]['columns'] = []
    sheet.getRow(5).eachCell((cell, column) => {
      const label = cellText(cell).trim()
      if (label) columns.push({ column, label, requirement: cellText(sheet.getCell(6, column)).trim(), guide: cellText(sheet.getCell(7, column)).slice(0, 10000) })
    })
    if (!columns.some((column) => column.label === '상품명') || !columns.some((column) => column.label === '공급가')) throw new Error(`${sheet.name}: 지원하는 쿠팡 카테고리 견적서가 아닙니다.`)
    return { name: sheet.name, columns }
  })
  if (!sheets.length || sheets.length > 20) throw new Error('쿠팡에서 받은 카테고리 견적서(QF 시트)를 선택해주세요.')
  return { id, name, sheets }
}

export async function readTemplate(buffer: Buffer, name: string) {
  if (buffer.length > 3_000_000) throw new Error('견적서는 파일당 3MB까지 불러올 수 있습니다.')
  const id = createHash('sha256').update(buffer).digest('hex')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
  const info = templateInfo(workbook, id, name)
  const rows: RegistrationRow[] = []
  for (const definition of info.sheets) {
    const sheet = workbook.getWorksheet(definition.name)!
    if (sheet.rowCount > 5000 || sheet.columnCount > 200) throw new Error('견적서가 지원하는 행·열 범위를 초과했습니다.')
    const nameColumn = definition.columns.find((column) => column.label === '상품명')!.column
    for (let index = 9; index <= sheet.rowCount; index++) {
      const productName = cellText(sheet.getCell(index, nameColumn)).trim()
      if (!productName) continue
      const fields = Object.fromEntries(definition.columns.map((column) => [column.label, cellText(sheet.getCell(index, column.column))]))
      rows.push({
        ...createRegistrationRow(), id: randomUUID(), templateId: id, sheetName: definition.name, name: productName,
        priceMode: 'manual', manualSupplyPrice: money(fields['공급가']),
        saleMode: money(fields['쿠팡 판매가']) === null ? 'auto' : 'manual', manualSalePrice: money(fields['쿠팡 판매가']), fields,
        primaryImage: fields['대표이미지 파일명'] ?? '', label: fields[LABEL_FIELD] ?? '',
      })
    }
  }
  if (rows.length > 500) throw new Error('한 작업에는 최대 500개 등록행을 사용할 수 있습니다.')
  return { template: { ...info, file: { name, data: buffer.toString('base64') } }, rows }
}

const numericFields = new Set(['공급가', '쿠팡 판매가', '박스 내 SKU 수량', '한 개 단품 포장 무게', '유통기간 *식품의 경우 소비기간\n(일수기재)'])

export async function buildRegistrationArchive(draft: RegistrationDraft): Promise<Buffer> {
  if (!draft.rows.length) throw new Error('등록할 상품을 추가해주세요.')
  const zip = new JSZip()
  const usedTemplates = draft.templates.filter((template) => draft.rows.some((row) => row.templateId === template.id))
  if (!usedTemplates.length) throw new Error('쿠팡 견적서를 먼저 불러와주세요.')
  // Re-read the actual uploaded template rather than trusting client-supplied columns.
  const verified: RegistrationDraft = { ...draft, templates: [] }
  const workbooks = new Map<string, ExcelJS.Workbook>()
  for (const template of usedTemplates) {
    const buffer = Buffer.from(template.file.data, 'base64')
    if (createHash('sha256').update(buffer).digest('hex') !== template.id) throw new Error('견적서 파일이 변경되었습니다. 다시 불러와주세요.')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer)
    verified.templates.push({ ...templateInfo(workbook, template.id, template.name), file: template.file })
    workbooks.set(template.id, workbook)
  }
  for (const row of draft.rows) {
    const issues = rowIssues(row, verified)
    if (issues.length) throw new Error(`${row.name}: ${issues.slice(0, 3).join(', ')}`)
  }
  for (const template of verified.templates) {
    const workbook = workbooks.get(template.id)!
    for (const definition of template.sheets) {
      const sheet = workbook.getWorksheet(definition.name)!
      if (sheet.rowCount > 5000 || sheet.columnCount > 200) throw new Error('지원하는 견적서 크기를 초과했습니다.')
      for (let index = 9; index <= sheet.rowCount; index++) {
        for (const column of definition.columns) {
          const cell = sheet.getCell(index, column.column)
          // Keep template formulas, validations, styles, hidden metadata and version rows.
          if (cell.type !== ExcelJS.ValueType.Formula) cell.value = null
        }
      }
      const entries = draft.rows.filter((row) => row.templateId === template.id && row.sheetName === definition.name)
      for (const [index, entry] of entries.entries()) {
        const fields = rowFields(entry, draft.rounding, draft.labels)
        for (const column of definition.columns) {
          const value = fields[column.label] ?? ''
          const cell = sheet.getCell(index + 9, column.column)
          if (!value && cell.type === ExcelJS.ValueType.Formula) continue
          if (value.length > 32767) throw new Error(`${entry.name}: ${column.label} 내용이 너무 깁니다.`)
          // Strings are literal cell values, never evaluate imported HTML or '=' text as formulas.
          cell.value = value === '' ? null : numericFields.has(column.label) && money(value) !== null ? money(value)! : value
        }
      }
    }
    const safeName = template.name.normalize('NFC').replace(/[\\/]/g, '_').replace(/\.xlsx$/i, '')
    zip.file(`견적서/${safeName}_등록용.xlsx`, await workbook.xlsx.writeBuffer())
  }
  const neededLabels = new Set(draft.rows.flatMap((row) => row.label.split(',').map(imageStem)))
  for (const file of draft.labels) {
    if (neededLabels.has(imageStem(file.name))) zip.file(`품질표시/${file.name.normalize('NFC')}`, checkedLabel(file))
  }
  zip.file('사용방법.txt', '견적서 폴더의 엑셀 파일을 쿠팡 서플라이어 허브에 업로드하세요.\n이미지는 공개 URL과 HTML로 연결되어 있습니다. 품질표시 폴더가 있으면 해당 이미지도 첨부하세요.\n내부 필수항목 검사를 통과한 파일이며 쿠팡 자체 검증·등록 승인은 별도로 진행해야 합니다.\n')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export function checkedLabel(file: SavedFile): Buffer {
  const buffer = Buffer.from(file.data, 'base64')
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if ((!jpeg && !png) || !/\.(jpe?g|png)$/i.test(file.name)) throw new Error('품질표시 파일은 JPG·PNG 이미지만 사용할 수 있습니다.')
  return buffer
}
