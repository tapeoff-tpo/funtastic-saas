import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { MarketplaceImportClient } from './import-client'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: '마켓플레이스 가져오기' }

export default async function MarketplaceImportPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const connections = await db
    .select({
      id: marketplaceConnections.id,
      marketplaceId: marketplaceConnections.marketplaceId,
      displayName: marketplaceConnections.displayName,
      status: marketplaceConnections.status,
    })
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.userId, user.id))

  const connected = connections.filter(
    (c) => c.status === 'connected',
  )

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">마켓플레이스 가져오기</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          연결된 마켓플레이스에서 상품을 내부 DB로 가져옵니다.
        </p>
      </div>
      {connected.length === 0 ? (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          연결된 마켓플레이스가 없습니다.{' '}
          <a href="/settings/marketplaces" className="text-blue-600 underline">
            마켓플레이스 연결
          </a>
          에서 먼저 연결하세요.
        </div>
      ) : (
        <MarketplaceImportClient connections={connected} />
      )}
    </div>
  )
}
