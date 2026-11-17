import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { listMarketplaceBusinessSettings } from '@/lib/marketplace/business-settings'
import { priceAmount } from './price-registration-values'

export async function getPriceRegistrationFees(userId: string) {
  const [settings, connections] = await Promise.all([
    listMarketplaceBusinessSettings(userId),
    db.select({ id: marketplaceConnections.marketplaceId, metadata: marketplaceConnections.metadata })
      .from(marketplaceConnections).where(eq(marketplaceConnections.userId, userId)),
  ])
  const ratesByMarketplace = new Map<string, Set<number | null>>()
  for (const row of connections) {
    const rates = ratesByMarketplace.get(row.id) ?? new Set()
    rates.add(priceAmount((row.metadata as Record<string, unknown> | null)?.salesFeePercent))
    ratesByMarketplace.set(row.id, rates)
  }
  const fees: Record<string, number> = {}
  for (const [id, rates] of ratesByMarketplace) {
    const [rate] = rates
    if (rates.size === 1 && rate !== null && rate <= 100) fees[id] = rate
  }
  for (const setting of settings) {
    const rate = priceAmount(setting.salesFeePercent)
    if (rate !== null && rate <= 100) fees[setting.marketplaceId] = rate
  }
  return fees
}
