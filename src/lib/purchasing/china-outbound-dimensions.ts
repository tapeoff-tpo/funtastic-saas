export type ChinaOutboundBoxDimensions = {
  manualCbm?: number | string | null
  lengthCm?: number | string | null
  widthCm?: number | string | null
  heightCm?: number | string | null
}

export function dimensionNumber(value: number | string | null | undefined) {
  if (value == null || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

/** Fills missing sides with equal lengths for the remaining CBM volume. These are estimates, not measurements. */
export function estimateChinaOutboundBoxDimensions(dimensions: ChinaOutboundBoxDimensions) {
  const cbm = dimensionNumber(dimensions.manualCbm)
  if (cbm == null || cbm < 0.000001 || cbm > 999_999_999) return null
  const fields = ['lengthCm', 'widthCm', 'heightCm'] as const
  const missing = fields.filter((field) => dimensions[field] == null || String(dimensions[field]).trim() === '')
  if (!missing.length) return null
  const measured = fields.filter((field) => !missing.includes(field))
  if (measured.some((field) => dimensionNumber(dimensions[field]) == null)) return null
  const knownVolume = measured.reduce((product, field) => product * dimensionNumber(dimensions[field])!, 1)
  const side = Math.round(Math.pow(cbm * 1_000_000 / knownVolume, 1 / missing.length) * 100) / 100
  if (!Number.isFinite(side) || side < 0.01 || side > 9_999_999.99) return null
  return Object.fromEntries(missing.map((field) => [field, side])) as Partial<Record<typeof fields[number], number>>
}

export function fillChinaOutboundDimensionInputs<T extends { lengthCm: string; widthCm: string; heightCm: string; manualCbm: string }>(values: T): T {
  const estimated = estimateChinaOutboundBoxDimensions(values)
  if (!estimated) return values
  return { ...values, ...Object.fromEntries(Object.entries(estimated).map(([field, value]) => [field, String(value)])) }
}

export function calculateChinaOutboundBoxCbm(dimensions: ChinaOutboundBoxDimensions) {
  const manualCbm = dimensionNumber(dimensions.manualCbm)
  if (manualCbm != null) return manualCbm
  const lengthCm = dimensionNumber(dimensions.lengthCm)
  const widthCm = dimensionNumber(dimensions.widthCm)
  const heightCm = dimensionNumber(dimensions.heightCm)
  if (lengthCm == null || widthCm == null || heightCm == null) return null
  return (lengthCm * widthCm * heightCm) / 1_000_000
}

export function formatChinaOutboundBoxDimensions(dimensions: ChinaOutboundBoxDimensions) {
  const lengthCm = dimensionNumber(dimensions.lengthCm)
  const widthCm = dimensionNumber(dimensions.widthCm)
  const heightCm = dimensionNumber(dimensions.heightCm)
  if (lengthCm == null || widthCm == null || heightCm == null) return null
  return `${formatDimension(lengthCm)} × ${formatDimension(widthCm)} × ${formatDimension(heightCm)} cm`
}

export function formatChinaOutboundCbm(cbm: number | null | undefined) {
  if (cbm == null || !Number.isFinite(cbm)) return null
  return new Intl.NumberFormat('ko-KR', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(cbm)
}

function formatDimension(value: number) {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)
}
