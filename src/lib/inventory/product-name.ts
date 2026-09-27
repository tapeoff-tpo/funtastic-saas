/** Removes the inventory-only brand suffix that Sabangnet exports in product names. */
export function normalizeInventoryProductName(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/_펀타스틱/gi, '')
    .replace(/_+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
