/**
 * Registry mapping marketplaceId → MarketplaceScraper instance.
 *
 * Add new scrapers here as they're built.
 * The scraper-worker uses this to route jobs based on marketplaceId.
 */

import type { MarketplaceId } from '@/lib/marketplace/types'
import type { MarketplaceScraper } from './types'

const _registry = new Map<MarketplaceId, MarketplaceScraper>()

export function registerScraper(scraper: MarketplaceScraper): void {
  _registry.set(scraper.marketplaceId, scraper)
}

export function getScraper(marketplaceId: MarketplaceId): MarketplaceScraper | null {
  return _registry.get(marketplaceId) ?? null
}

export function listScrapers(): MarketplaceScraper[] {
  return [...(_registry.values?.() ?? [])]
}

export function hasScraper(marketplaceId: MarketplaceId): boolean {
  return _registry.has(marketplaceId)
}
