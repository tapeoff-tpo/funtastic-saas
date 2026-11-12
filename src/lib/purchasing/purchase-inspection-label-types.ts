export const INSPECTION_LABEL_KINDS = ['quality', 'barcode'] as const
export const INSPECTION_LABEL_SOURCES = ['upload', 'attachment', 'works'] as const

export type InspectionLabelKind = (typeof INSPECTION_LABEL_KINDS)[number]
export type InspectionLabelSource = (typeof INSPECTION_LABEL_SOURCES)[number]
export type InspectionLabelFile = {
  id: string
  kind: InspectionLabelKind
  source: InspectionLabelSource
  fileName: string
  contentType: string
}

export const INSPECTION_LABEL_FILE_LIMIT = 4 * 1024 * 1024
export const INSPECTION_LABEL_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
