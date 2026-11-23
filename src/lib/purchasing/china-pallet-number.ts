/** Only positive whole-number input assigns a pallet. All other text means loose boxes. */
export function normalizeChinaPalletNumber(value: string | null | undefined): string | null {
  const text = value?.normalize('NFKC').trim() ?? ''
  return /^[0-9]+$/.test(text) && /[1-9]/.test(text) ? text.replace(/^0+/, '') : null
}
