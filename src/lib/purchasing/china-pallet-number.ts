/** Only positive whole-number input assigns a pallet. All other text means loose boxes. */
export function normalizeChinaPalletNumber(value: string | null | undefined): string | null {
  const text = value?.normalize('NFKC').trim() ?? ''
  return /^[0-9]+$/.test(text) && /[1-9]/.test(text) ? text.replace(/^0+/, '') : null
}

/** Read old loose-box labels without changing stored rows or historical P1-style pallet IDs. */
export function resolveChinaLooseBoxes<P extends { id: string; palletNo: string }, B extends { palletId: string | null }>(pallets: P[], boxes: B[]) {
  const looseIds = new Set(pallets.filter((pallet) => !normalizeChinaPalletNumber(pallet.palletNo)
    && !/^(?:P|PLT|PALLET|파렛트|파레트)[\s-]*[1-9]\d*$/i.test(pallet.palletNo.trim())).map((pallet) => pallet.id))
  return {
    pallets: pallets.filter((pallet) => !looseIds.has(pallet.id)),
    boxes: boxes.map((box) => box.palletId && looseIds.has(box.palletId) ? { ...box, palletId: null } : box),
  }
}
