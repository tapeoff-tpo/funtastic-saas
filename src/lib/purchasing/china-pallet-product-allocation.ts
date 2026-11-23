/** Stable largest-remainder rounding keeps the displayed product shares equal
 * to the physical pallet total, down to 0.0001 CBM / 0.001 kg. */
export function allocatePalletMeasure(total: number, weights: number[], decimals: number) {
  if (!Number.isFinite(total) || total < 0 || !weights.length || weights.some((weight) => !Number.isFinite(weight) || weight < 0)) return null
  const sum = weights.reduce((value, weight) => value + weight, 0)
  if (!(sum > 0)) return null
  const scale = 10 ** decimals, units = Math.round(total * scale)
  const shares = weights.map((weight, index) => {
    const exact = units * weight / sum
    return { index, units: Math.floor(exact), fraction: exact % 1 }
  })
  const remainder = units - shares.reduce((value, share) => value + share.units, 0)
  for (const share of [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index).slice(0, remainder)) share.units++
  return shares.map((share) => share.units / scale)
}

/** Packaging weight is added to each product's existing box weight. */
export function allocatePalletProducts(products: Array<{ productCode: string; loadedCbm: number; boxWeightKg: number }>, finalCbm: number, tareWeightKg: number) {
  const weights = products.map((product) => product.loadedCbm)
  const cbm = allocatePalletMeasure(finalCbm, weights, 4)
  const tare = allocatePalletMeasure(tareWeightKg, weights, 3)
  if (!cbm || !tare) return null
  const loaded = products.reduce((sum, product) => sum + product.loadedCbm, 0)
  return products.map((product, index) => ({ ...product, volumeRatio: product.loadedCbm / loaded,
    finalCbm: cbm[index], addedCbm: cbm[index] - product.loadedCbm,
    tareWeightKg: tare[index], grossWeightKg: Math.round((product.boxWeightKg + tare[index]) * 1000) / 1000 }))
}
