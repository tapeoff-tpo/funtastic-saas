import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { getIntegrationMethod, getSupportedIntegrationMethods } from '@/lib/marketplace/integration-methods'
import '@/lib/marketplace/adapters/configs'
import { IntegrationForms } from '@/components/marketplace/integration-forms'
import { ConnectionList } from './connection-list'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import type { IntegrationMethod } from '@/lib/marketplace/integration-methods'

export default async function MarketplaceSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const configs = marketplaceRegistry.listConfigs()
  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.userId, workspaceUserId))
  const visibleConnections = connections.filter((connection) => !isDomechangoManualConnection(connection))

  const connectedMethodCounts = new Map<string, Partial<Record<IntegrationMethod, number>>>()
  const connectedAliases = new Map<string, string[]>()
  visibleConnections.forEach((c) => {
    const method = getIntegrationMethod(c.marketplaceId, {
      isManual: c.isManual,
      authType: c.authType,
    })
    const counts = connectedMethodCounts.get(c.marketplaceId) ?? {}
    counts[method] = (counts[method] ?? 0) + 1
    connectedMethodCounts.set(c.marketplaceId, counts)
    connectedAliases.set(c.marketplaceId, [
      ...(connectedAliases.get(c.marketplaceId) ?? []),
      c.storeAlias,
    ])
  })

  const catalog = configs.map((config) => ({
    id: config.id,
    name: config.name,
    requiredCredentials: [...config.requiredCredentials],
    integrationMethod: getIntegrationMethod(config.id, { authType: config.authType }),
    supportedMethods: getSupportedIntegrationMethods(config.id, { authType: config.authType }),
    connectedMethodCounts: connectedMethodCounts.get(config.id) ?? {},
    connectedAliases: connectedAliases.get(config.id) ?? [],
  }))
  const marketplaceNames = new Map(configs.map((config) => [config.id, config.name]))
  const connectionRows = visibleConnections.map((connection) => ({
    id: connection.id,
    marketplaceId: connection.marketplaceId,
    marketplaceName: marketplaceNames.get(connection.marketplaceId) ?? connection.displayName,
    storeAlias: connection.storeAlias,
    displayName: connection.displayName,
    status: connection.status,
    integrationMethod: getIntegrationMethod(connection.marketplaceId, {
      isManual: connection.isManual,
      authType: connection.authType,
    }),
    linkedMarketplaces: linkedMarketplacesFromMetadata(connection.metadata),
  }))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">마켓플레이스 연동 설정</h1>
        <p className="mt-1 text-muted-foreground">
          자동 연동과 엑셀 업로드몰을 등록하고 연결 상태를 관리합니다.
        </p>
      </div>

      <IntegrationForms
        marketplaces={catalog}
      />

      {connectionRows.length > 0 && (
        <ConnectionList connections={connectionRows} pageSize={10} />
      )}
    </div>
  )
}

function linkedMarketplacesFromMetadata(metadata: Record<string, unknown> | null | undefined): string[] {
  const value = metadata?.linkedMarketplaces
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : []
}

function isDomechangoManualConnection(connection: typeof marketplaceConnections.$inferSelect): boolean {
  const displayNameKey = connection.displayName.replace(/\s+/g, '')
  return connection.isManual && (connection.marketplaceId === 'domechango' || displayNameKey.includes('도매창고'))
}
