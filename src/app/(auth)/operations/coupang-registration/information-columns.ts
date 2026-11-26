import {
  isAutomaticTemplateColumn,
  LABEL_FIELD,
  PACKAGING_SIZE_FIELD,
  PACKAGING_WEIGHT_FIELD,
  registrationCommonSheet,
  registrationFieldKey,
  registrationFieldValue,
  registrationInformationSheet,
  type RegistrationDraft,
  type RegistrationRow,
  type TemplateColumn,
  type TemplateSheet,
} from '@/lib/coupang-registration/model'

export type InformationColumn = {
  key: string
  label: string
  /** Position among columns with the same label in the original sheet. */
  occurrence: number
  headerLabel: string
  requiredAny: boolean
  conditionalAny: boolean
}

export type InformationCell = {
  column: TemplateColumn
  fieldKey: string
  value: string
}

export type InformationRowColumns = {
  sheet: TemplateSheet
  hasOfficialSheet: boolean
  columns: Map<string, InformationCell>
}

export type InformationColumns = {
  columns: InformationColumn[]
  rows: Map<string, InformationRowColumns>
}

export type InformationRowGroup = {
  key: string
  name: string
  fileName: string
  rows: RegistrationRow[]
  hasOfficialSheet: boolean
}

const dedicatedFields = new Set([
  '상품명', '공급가', '쿠팡 판매가', '대표이미지 파일명', '추가이미지 파일명',
  '상세이미지 파일명', 'HTML 상품 상세 컨텐츠', LABEL_FIELD,
])

/** Units describe the screen header; official labels and saved field keys stay unchanged. */
export function informationHeaderLabel(label: string): string {
  if (label === PACKAGING_SIZE_FIELD) return `${label} (mm)`
  if (label === PACKAGING_WEIGHT_FIELD) return `${label} (g)`
  return label
}

/** Separate tables by the exact original file and sheet, retaining the original rows. */
export function groupInformationRows(
  rows: readonly RegistrationRow[],
  templates: RegistrationDraft['templates'],
): InformationRowGroup[] {
  const groups = new Map<string, InformationRowGroup>()
  for (const row of rows) {
    const template = templates.find(template => template.id === row.templateId)
    const sheet = template?.sheets.find(sheet => sheet.name === row.sheetName)
    const key = sheet ? JSON.stringify([row.templateId, sheet.name]) : 'unassigned'
    const existing = groups.get(key)
    if (existing) existing.rows.push(row)
    else groups.set(key, {
      key,
      name: sheet ? sheet.name.replace(/^QF_\d+_/, '') : '양식 미선택',
      fileName: sheet ? template!.name || template!.file.name : '',
      rows: [row],
      hasOfficialSheet: !!sheet,
    })
  }
  return [...groups.values()]
}

/** Keep original headers and keys alongside the shared required registration information. */
export function buildInformationColumns(
  rows: readonly RegistrationRow[],
  templates: RegistrationDraft['templates'],
): InformationColumns {
  const headers = new Map<string, InformationColumn>()
  const rowColumns = new Map<string, InformationRowColumns>()

  for (const row of rows) {
    const officialSheet = templates.find(template => template.id === row.templateId)
      ?.sheets.find(sheet => sheet.name === row.sheetName)
    const sheet = registrationInformationSheet(officialSheet ?? registrationCommonSheet)
    const occurrences = new Map<string, number>()
    const cells = new Map<string, InformationCell>()

    for (const column of sheet.columns) {
      // Count before excluding formula columns so duplicate positions stay stable.
      const occurrence = (occurrences.get(column.label) ?? 0) + 1
      occurrences.set(column.label, occurrence)
      if (dedicatedFields.has(column.label) || isAutomaticTemplateColumn(column)) continue

      const key = JSON.stringify([column.label, occurrence])
      const value = registrationFieldValue(row, sheet, column) ?? ''
      cells.set(key, { column, fieldKey: registrationFieldKey(row, sheet, column), value })

      const required = column.requirement === '필수'
      const conditional = column.requirement.includes('조건부')

      const existing = headers.get(key)
      if (existing) {
        existing.requiredAny ||= required
        existing.conditionalAny ||= conditional
      } else {
        headers.set(key, {
          key, label: column.label, occurrence,
          headerLabel: occurrence === 1 ? informationHeaderLabel(column.label) : `${informationHeaderLabel(column.label)} ${occurrence}`,
          requiredAny: required, conditionalAny: conditional,
        })
      }
    }

    rowColumns.set(row.id, { sheet, hasOfficialSheet: !!officialSheet, columns: cells })
  }

  return { columns: [...headers.values()], rows: rowColumns }
}
