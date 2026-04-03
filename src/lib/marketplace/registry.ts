import type { MarketplaceAdapter, MarketplaceConfig, MarketplaceId } from './types'

/**
 * Registry for marketplace adapters.
 *
 * New marketplace integrations register themselves here.
 * The registry enforces uniqueness and provides lookup by marketplace ID.
 *
 * Usage:
 *   import { marketplaceRegistry } from '@/lib/marketplace/registry'
 *   marketplaceRegistry.register(coupangAdapter)
 *   const adapter = marketplaceRegistry.get('coupang')
 */
export class MarketplaceRegistry {
  private adapters = new Map<string, MarketplaceAdapter>()

  /**
   * Register a marketplace adapter. Throws if an adapter with the same ID already exists.
   */
  register(adapter: MarketplaceAdapter): void {
    const id = adapter.config.id
    if (this.adapters.has(id)) {
      throw new Error(`Adapter already registered: ${id}`)
    }
    this.adapters.set(id, adapter)
  }

  /**
   * Get an adapter by marketplace ID. Throws if not found.
   */
  get(id: MarketplaceId): MarketplaceAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      const available = Array.from(this.adapters.keys()).join(', ')
      throw new Error(
        `Unknown marketplace: ${id}. Available: [${available}]`
      )
    }
    return adapter
  }

  /**
   * Check if a marketplace adapter is registered.
   */
  has(id: MarketplaceId): boolean {
    return this.adapters.has(id)
  }

  /**
   * List all registered marketplace IDs.
   */
  listIds(): string[] {
    return Array.from(this.adapters.keys())
  }

  /**
   * List configs for all registered marketplace adapters.
   */
  listConfigs(): MarketplaceConfig[] {
    return Array.from(this.adapters.values()).map((a) => a.config)
  }
}

/** Global singleton registry — import this in application code */
export const marketplaceRegistry = new MarketplaceRegistry()
