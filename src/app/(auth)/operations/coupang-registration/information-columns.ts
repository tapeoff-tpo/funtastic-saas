import {
  isAutomaticTemplateColumn,
  LABEL_FIELD,
  registrationCommonSheet,
  registrationFieldKey,
  registrationFieldValue,
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

const dedicatedFields = new Set([
  '상품명', '공급가', '쿠팡 판매가', '대표이미지 파일명', '추가이미지 파일명',
  '상세이미지 파일명', 'HTML 상품 상세 컨텐츠', LABEL_FIELD,
])

/** Share visual headers across files while keeping each cell's original field key. */
export function buildInformationColumns(
  rows: readonly RegistrationRow[],
  templates: RegistrationDraft['templates'],
): InformationColumns {
  const headers = new Map<string, InformationColumn>()
  const rowColumns = new Map<string, InformationRowColumns>()

  for (const row of rows) {
    const officialSheet = templates.find(template => template.id === row.templateId)
      ?.sheets.find(sheet => sheet.name === row.sheetName)
    const sheet = officialSheet ?? registrationCommonSheet
    const occurrences = new Map<string, number>()
    const cells = new Map<string, InformationCell>()

    for (const column of sheet.columns) {
      // Count before filtering: a hidden first column must not rename the second.
      const occurrence = (occurrences.get(column.label) ?? 0) + 1
      occurrences.set(column.label, occurrence)
      if (dedicatedFields.has(column.label) || isAutomaticTemplateColumn(column)) continue

      const key = JSON.stringify([column.label, occurrence])
      const value = registrationFieldValue(row, sheet, column) ?? ''
      cells.set(key, { column, fieldKey: registrationFieldKey(row, sheet, column), value })

      const required = column.requirement === '필수'
      const conditional = column.requirement.includes('조건부')
      if (officialSheet && !required && !conditional && !value) continue

      const existing = headers.get(key)
      if (existing) {
        existing.requiredAny ||= required
        existing.conditionalAny ||= conditional
      } else {
        headers.set(key, {
          key, label: column.label, occurrence,
          headerLabel: occurrence === 1 ? column.label : `${column.label} ${occurrence}`,
          requiredAny: required, conditionalAny: conditional,
        })
      }
    }

    rowColumns.set(row.id, { sheet, hasOfficialSheet: !!officialSheet, columns: cells })
  }

  // A blank optional cell remains editable if another row exposes that header.
  // Columns absent from a row's own sheet have no cell mapping at all.
  for (const { columns } of rowColumns.values()) {
    for (const key of columns.keys()) if (!headers.has(key)) columns.delete(key)
  }
  return { columns: [...headers.values()], rows: rowColumns }
}
