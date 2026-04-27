import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { MarketplaceDashboard } from '@/components/marketplace/marketplace-dashboard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '주문 수집',
}

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

  if (connections.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">주문 수집</h1>
        <div className="mt-8 rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <p className="text-muted-foreground">
            아직 연결된 마켓플레이스가 없습니다.
          </p>
          <Link
            href="/settings/marketplaces"
            className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            마켓플레이스 연동하기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">주문 수집</h1>
      <MarketplaceDashboard
        connections={connections.map((c) => ({
          marketplaceId: c.marketplaceId,
          displayName: c.displayName,
          status: c.status,
          lastCheckedAt: c.lastCheckedAt,
          lastErrorMessage: c.lastErrorMessage,
          expiresAt: c.expiresAt,
          isManual: c.isManual,
        }))}
      />
    </div>
  )
}
