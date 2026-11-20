/** A source row and its following blank option rows share these physical cartons. */
export type ChinaInventoryPackingGroup = {
  version: 1
  key: string
  totalBoxCount: number
  referenceQuantity: number
  memberStartQuantity: number
  grossWeightKg: number | null
  manualCbm: number | null
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
}

export function normalizeChinaInventoryPackingGroup(value: unknown): ChinaInventoryPackingGroup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.version !== 1 || typeof row.key !== 'string' || !row.key.trim() || row.key.length > 100) return null
  if (!Number.isSafeInteger(row.totalBoxCount) || Number(row.totalBoxCount) < 1 || Number(row.totalBoxCount) > 2_147_483_647) return null
  if (!Number.isSafeInteger(row.referenceQuantity) || Number(row.referenceQuantity) < 1 || Number(row.referenceQuantity) > 2_147_483_647) return null
  if (!Number.isSafeInteger(row.memberStartQuantity) || Number(row.memberStartQuantity) < 0 || Number(row.memberStartQuantity) >= Number(row.referenceQuantity)) return null
  const measurementFields = ['grossWeightKg', 'manualCbm', 'lengthCm', 'widthCm', 'heightCm'] as const
  if (measurementFields.some((field) => row[field] != null && (typeof row[field] !== 'number' || !Number.isFinite(row[field]) || Number(row[field]) < 0 || Number(row[field]) > 999_999_999))) return null
  return {
    version: 1, key: row.key.trim(), totalBoxCount: Number(row.totalBoxCount), referenceQuantity: Number(row.referenceQuantity), memberStartQuantity: Number(row.memberStartQuantity),
    grossWeightKg: row.grossWeightKg == null ? null : Number(row.grossWeightKg),
    manualCbm: row.manualCbm == null ? null : Number(row.manualCbm),
    lengthCm: row.lengthCm == null ? null : Number(row.lengthCm),
    widthCm: row.widthCm == null ? null : Number(row.widthCm),
    heightCm: row.heightCm == null ? null : Number(row.heightCm),
  }
}

/** Rounded cumulative boundaries conserve the source total across all options. */
export function proportionalInventoryPackingShare(total: number | null, referenceQuantity: number, startQuantity: number, quantity: number, precision: number): number | null {
  if (total == null) return null
  const units = Math.round(total * precision)
  return (Math.round(units * (startQuantity + quantity) / referenceQuantity) - Math.round(units * startQuantity / referenceQuantity)) / precision
}
