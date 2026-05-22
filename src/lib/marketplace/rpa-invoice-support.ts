import type { MarketplaceId } from './types'

export const RPA_INVOICE_UPLOAD_MARKETPLACE_IDS = [
  'domechango',
  'onchannel',
] as const satisfies readonly MarketplaceId[]

const rpaInvoiceUploadMarketplaceIds = new Set<MarketplaceId>(RPA_INVOICE_UPLOAD_MARKETPLACE_IDS)

export function supportsRpaInvoiceUpload(marketplaceId: string): boolean {
  return rpaInvoiceUploadMarketplaceIds.has(marketplaceId as MarketplaceId)
}
