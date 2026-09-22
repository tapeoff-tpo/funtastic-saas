export type ChinaOutboundBoxDimensions = {
  lengthCm?: number | string | null
  widthCm?: number | string | null
  heightCm?: number | string | null
}

export function dimensionNumber(value: number | string | null | undefined) {
  if (value == null || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

export function calculateChinaOutboundBoxCbm(dimensions: ChinaOutboundBoxDimensions) {
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
