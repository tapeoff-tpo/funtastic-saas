import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { excelImportTemplates, marketplaceConnections } from '@/lib/db/schema'
import { MarketplaceDashboard } from '@/components/marketplace/marketplace-dashboard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '주문 수집',
}

const AUTO_MARKETPLACE_OPTIONS = [
  { marketplaceId: 'domeggook', displayName: '도매꾹' },
  { marketplaceId: 'tobizon', displayName: '투비즈온' },
  { marketplaceId: 'domesin', displayName: '도매의신' },
  { marketplaceId: 'banana-b2b', displayName: '바나나B2B' },
  { marketplaceId: 'ohouse', displayName: '오늘의집' },
  { marketplaceId: 'ssgmall', displayName: 'SSG' },
  { marketplaceId: 'cjonestyle', displayName: 'CJ온스타일' },
  { marketplaceId: 'ably', displayName: '에이블리' },
  { marketplaceId: 'hyundai-hmall', displayName: '현대홈쇼핑' },
  { marketplaceId: 'gs-shop', displayName: 'GS샵' },
  { marketplaceId: 'esm', displayName: 'ESM' },
  { marketplaceId: 'always', displayName: '올웨이즈' },
  { marketplaceId: 'elevenst', displayName: '11번가' },
  { marketplaceId: 'zigzag', displayName: '지그재그' },
  { marketplaceId: 'toss-shopping', displayName: '토스쇼핑' },
] as const

export default async function OrdersCollectPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.userId, user.id))

  const importTemplates = await db
    .select({
      id: excelImportTemplates.id,
      name: excelImportTemplates.name,
      mappings: excelImportTemplates.mappings,
      isDefault: excelImportTemplates.isDefault,
    })
    .from(excelImportTemplates)
    .where(eq(excelImportTemplates.userId, user.id))

  const connectionRows = connections.map((c) => ({
    id: c.id,
    marketplaceId: c.marketplaceId,
    displayName: c.displayName,
    status: c.status,
    lastCheckedAt: c.lastCheckedAt,
    lastErrorMessage: c.lastErrorMessage,
    expiresAt: c.expiresAt,
    isManual: c.isManual,
  }))

  const existingAutoMarketplaceIds = new Set(
    connectionRows.filter((c) => !c.isManual).map((c) => c.marketplaceId)
  )

  const dashboardConnections = [
    ...connectionRows,
    ...AUTO_MARKETPLACE_OPTIONS
      .filter((marketplace) => !existingAutoMarketplaceIds.has(marketplace.marketplaceId))
      .map((marketplace) => ({
        id: `auto-placeholder-${marketplace.marketplaceId}`,
        marketplaceId: marketplace.marketplaceId,
        displayName: marketplace.displayName,
        status: 'disconnected',
        lastCheckedAt: null,
        lastErrorMessage: null,
        expiresAt: null,
        isManual: false,
      })),
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">주문 수집</h1>
      <MarketplaceDashboard
        connections={dashboardConnections}
        importTemplates={importTemplates}
      />
    </div>
  )
}
