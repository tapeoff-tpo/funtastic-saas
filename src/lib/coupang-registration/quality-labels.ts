import type { RegistrationRow, SavedFile } from './model'

export const QUALITY_LABEL_MAX_PDF_BYTES = 4_000_000
export const QUALITY_LABEL_MAX_PAGES = 4
export const QUALITY_LABEL_MAX_TOTAL_BYTES = 2_400_000
export const QUALITY_LABEL_MAX_FILE_BYTES = 1_500_000
export const QUALITY_LABEL_RENDER_SCALE = 2.5
export const QUALITY_LABEL_MAX_PIXELS = 12_000_000

function labelNames(value: string) {
  return value.split(',').map((name) => name.trim()).filter(Boolean)
}

function fileNameStem(value: string) {
  const stem = value.normalize('NFC').trim().split(/[/\\]/).pop()?.replace(/\.[^.]*$/, '') ?? ''
  return stem.replace(/[\\/:*?"<>|]/g, '_').trim() || '품질표시'
}

/** Gives every PDF page a stable, ZIP-safe JPG filename. */
export function qualityLabelFileName(pdfFileName: string, attachmentId: string, page: number, pageCount: number) {
  const safeId = attachmentId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12) || 'pdf'
  const suffix = `-${safeId}-p${page}${pageCount > 1 ? `of${pageCount}` : ''}.jpg`
  return `${fileNameStem(pdfFileName).slice(0, Math.max(1, 250 - suffix.length))}${suffix}`
}

/** A direct label edit, including a deliberate clear, always wins over PDF defaults. */
export function canReplaceWithQualityPdfLabel(row: Pick<RegistrationRow, 'label' | 'autoQualityLabel'>) {
  const current = row.label.trim()
  if (!current) return !row.autoQualityLabel
  return row.autoQualityLabel?.value === current
}

export function qualityPdfNeedsConversion(
  row: Pick<RegistrationRow, 'label' | 'autoQualityLabel'>,
  qualityPdfId: string,
  labels: SavedFile[],
) {
  if (!canReplaceWithQualityPdfLabel(row)) return false
  const automatic = row.autoQualityLabel
  if (!automatic || automatic.sourcePdfId !== qualityPdfId) return true
  const present = new Set(labels.map((file) => file.name.normalize('NFC')))
  return labelNames(automatic.value).some((name) => !present.has(name.normalize('NFC')))
}

export function applyConvertedQualityLabels(
  row: RegistrationRow,
  qualityPdfId: string,
  labels: SavedFile[],
): RegistrationRow {
  const value = labels.map((file) => file.name.normalize('NFC')).join(',')
  if (!value || !canReplaceWithQualityPdfLabel(row)) return row
  return {
    ...row,
    label: value,
    autoQualityLabel: { sourcePdfId: qualityPdfId, value },
    qualityLabelIssue: undefined,
  }
}

export function applyQualityLabelIssue(row: RegistrationRow, issue: string): RegistrationRow {
  if (!canReplaceWithQualityPdfLabel(row)) return row
  return {
    ...row,
    qualityLabelIssue: issue.slice(0, 500),
  }
}
