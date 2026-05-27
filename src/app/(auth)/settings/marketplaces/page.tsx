import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { commonAuthProfiles, marketplaceConnections } from '@/lib/db/schema'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { getIntegrationMethod, getSupportedIntegrationMethods } from '@/lib/marketplace/integration-methods'
import '@/lib/marketplace/adapters/configs'
import { IntegrationForms } from '@/components/marketplace/integration-forms'
import { ConnectionList } from './connection-list'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { ensureCommonAuthProfilesTable } from '@/lib/common-auth-profiles'
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
  let authProfiles: Array<{
    id: string
    name: string
    provider: string
    accountEmail: string
    isDefault: boolean
  }> = []
  try {
    await ensureCommonAuthProfilesTable()
    authProfiles = await db
      .select({
        id: commonAuthProfiles.id,
        name: commonAuthProfiles.name,
        provider: commonAuthProfiles.provider,
        accountEmail: commonAuthProfiles.accountEmail,
        isDefault: commonAuthProfiles.isDefault,
      })
      .from(commonAuthProfiles)
      .where(eq(commonAuthProfiles.userId, workspaceUserId))
  } catch (error) {
    console.error('[settings/marketplaces] common auth profile table unavailable', error)
  }
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
    salesExportMarketplaceId: typeof connection.metadata?.salesExportMarketplaceId === 'string'
      ? connection.metadata.salesExportMarketplaceId
      : '',
    salesFeePercent: parseSalesFeePercentForInput(connection.metadata?.salesFeePercent),
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
        authProfiles={authProfiles}
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

function parseSalesFeePercentForInput(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const numericValue = Number(trimmed)
    return trimmed !== '' && Number.isFinite(numericValue) ? trimmed : ''
  }
  return ''
}

function isDomechangoManualConnection(connection: typeof marketplaceConnections.$inferSelect): boolean {
  const displayNameKey = connection.displayName.replace(/\s+/g, '')
  return connection.isManual && (connection.marketplaceId === 'domechango' || displayNameKey.includes('도매창고'))
}
