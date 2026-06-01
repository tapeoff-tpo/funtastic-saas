import type { ParsedOrderRow } from './excel-import'

export function normalizeImportedOrderItem(item: ParsedOrderRow, marketplaceId: string): ParsedOrderRow {
  if (marketplaceId === 'funtastic-b2b' || marketplaceId === 'manual-NUQyoT') {
    const productUniqueId = item.sku?.trim()
    return productUniqueId
      ? { ...item, marketplaceItemId: productUniqueId }
      : item
  }

  if (marketplaceId !== 'ownerclan') return item
  const skuParts = item.sku?.split(/\s+/).filter(Boolean) ?? []
  if (skuParts.length === 0) return item

  const marketplaceItemId = !item.marketplaceItemId || /^\d+$/.test(item.marketplaceItemId)
    ? skuParts[0]
    : item.marketplaceItemId
  const sku = skuParts.length > 1 ? skuParts.slice(1).join(' ') : item.sku

  return { ...item, marketplaceItemId, sku }
}
