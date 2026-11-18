export const DEFAULT_PALLET_TARE_KG = 5

/** Pallet packaging is distinct from its automatically calculated loaded weight. */
export function palletTareWeightKg(value?: string | number | null): number {
  if (value === null || value === undefined || value === '') return DEFAULT_PALLET_TARE_KG
  const weight = Number(value)
  return Number.isFinite(weight) && weight >= 0 && weight <= 999_999_999
    ? Math.round(weight * 1_000) / 1_000 : DEFAULT_PALLET_TARE_KG
}

/** Callers supply loaded physical boxes; mixed product allocations count once. */
export function calculateChinaOutboundPalletWeight(boxes: Array<{ id: string; grossWeightKg?: string | number | null }>, tare?: string | number | null) {
  const tareWeightKg = palletTareWeightKg(tare)
  let boxGrams = 0
  let missingBoxWeightCount = 0
  for (const box of new Map(boxes.map((box) => [box.id, box])).values()) {
    const weight = box.grossWeightKg == null || box.grossWeightKg === '' ? Number.NaN : Number(box.grossWeightKg)
    if (!Number.isFinite(weight) || weight < 0.001 || weight > 999_999_999) missingBoxWeightCount += 1
    else boxGrams += Math.round(weight * 1_000)
  }
  return {
    tareWeightKg,
    boxWeightKg: missingBoxWeightCount ? null : boxGrams / 1_000,
    grossWeightKg: missingBoxWeightCount ? null : (boxGrams + Math.round(tareWeightKg * 1_000)) / 1_000,
    missingBoxWeightCount,
  }
}
