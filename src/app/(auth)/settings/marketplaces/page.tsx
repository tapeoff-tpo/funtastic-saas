import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import '@/lib/marketplace/adapters/configs'
import { CredentialForm } from '@/components/marketplace/credential-form'
import { ConnectionRow } from './edit-button'
import type { ConnectionStatus } from '@/lib/marketplace/types'

export default async function MarketplaceSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const configs = marketplaceRegistry.listConfigs()
  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.userId, user.id))

  const connectedIds = new Set(connections.map((c) => c.marketplaceId))

  const marketplaceOptions = configs.map((config) => ({
    id: config.id,
    name: config.name,
    requiredCredentials: [...config.requiredCredentials],
    isConnected: connectedIds.has(config.id),
  }))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">마켓플레이스 연동 설정</h1>
        <p className="mt-1 text-muted-foreground">
          API 인증정보를 등록하여 마켓플레이스를 연동합니다.
        </p>
      </div>

      <CredentialForm marketplaces={marketplaceOptions} />

      {connections.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">연결된 마켓플레이스</h2>
          <div className="divide-y rounded-lg border">
            {connections.map((conn) => (
              <ConnectionRow
                key={conn.id}
                connectionId={conn.id}
                displayName={conn.displayName}
                status={conn.status as ConnectionStatus}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
