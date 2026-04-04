import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { HealthCard } from '@/components/marketplace/health-card'
import { CollectOrdersPanel } from '@/components/marketplace/collect-orders-panel'
import type { ConnectionStatus } from '@/lib/marketplace/types'

export default async function DashboardPage() {
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">마켓플레이스 연동 현황</h1>
          <p className="mt-1 text-muted-foreground">
            연결된 마켓플레이스의 상태를 확인합니다.
          </p>
        </div>
        {connections.length > 0 && (
          <CollectOrdersPanel
            connections={connections.map((c) => ({
              marketplaceId: c.marketplaceId,
              displayName: c.displayName,
              status: c.status,
            }))}
          />
        )}
      </div>

      {connections.length === 0 ? (
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
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => (
            <HealthCard
              key={conn.id}
              marketplaceId={conn.marketplaceId}
              displayName={conn.displayName}
              status={conn.status as ConnectionStatus}
              lastCheckedAt={conn.lastCheckedAt}
              lastErrorMessage={conn.lastErrorMessage}
              expiresAt={conn.expiresAt}
            />
          ))}
        </div>
      )}
    </div>
  )
}
