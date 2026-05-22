import type { MarketplaceId } from '@/lib/marketplace/types'

export const REGISTERED_SCRAPER_MARKETPLACE_IDS = [
  'domechango',
  'onchannel',
  'tobizon',
  'banana-b2b',
  'domesin',
  'ohouse',
  'gs-shop',
  'always',
] as const satisfies readonly MarketplaceId[]

const registeredScraperMarketplaceIds = new Set<MarketplaceId>(REGISTERED_SCRAPER_MARKETPLACE_IDS)

export function isRegisteredScraperMarketplace(marketplaceId: string): boolean {
  return registeredScraperMarketplaceIds.has(marketplaceId as MarketplaceId)
}
