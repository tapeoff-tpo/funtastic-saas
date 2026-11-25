export type ImportDocumentEditField = { key: string; label: string; value: string; type?: 'text' | 'date' | 'number' }
export type ImportDocumentEditCells = Record<string, ImportDocumentEditField[]>
export type ImportDocumentDraft = {
  merges?: Array<{ source: string; target: string }>
  invoiceNo: string; invoiceDate: string; sailingDate: string
  exporter: string; importer: string; importerAddress: string
  loadingPort: string; destinationPort: string; paymentTerms: string
  palletTareKg: number; palletExtraCbm: number
  items: Record<string, { englishName: string; unitPriceCny: number | null; hsCode?: string }>
  boxes: Record<string, { grossWeightKg: number | null; cbm: number | null }>
}

export function importDocumentProductCode(sku: string) {
  const normalized = sku.trim()
  return normalized.match(/^(\d+)-\d{4}$/)?.[1] ?? normalized
}
