import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import '@/lib/marketplace/adapters/configs'
import { CredentialForm } from '@/components/marketplace/credential-form'
import { IntegrationForms } from '@/components/marketplace/integration-forms'
import { ConnectionList } from './connection-list'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

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

  const connectedMethodIds = new Set(
    connections.map((c) => {
      const method = getIntegrationMethod(c.marketplaceId, {
        isManual: c.isManual,
        authType: c.authType,
      })
      return `${method}:${c.marketplaceId}`
    }),
  )

  const catalog = configs.map((config) => ({
    id: config.id,
    name: config.name,
    requiredCredentials: [...config.requiredCredentials],
    integrationMethod: getIntegrationMethod(config.id, { authType: config.authType }),
  }))
  const linkedMarketplaceOptions = catalog.map((marketplace) => ({
    id: marketplace.id,
    name: marketplace.name,
    requiredCredentials: marketplace.requiredCredentials,
  }))
  const excelConnectionOptions = catalog.map((marketplace) => ({
    id: marketplace.id,
    name: marketplace.name,
    isConnected: connectedMethodIds.has(`excel:${marketplace.id}`),
  }))
  const connectionRows = connections.map((connection) => ({
    id: connection.id,
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

      <CredentialForm
        title="연동"
        description="API 또는 주문 허브로 연결하는 마켓을 등록합니다."
        selectLabel="마켓"
        marketplaces={linkedMarketplaceOptions}
      />

      <IntegrationForms
        excelMarketplaces={excelConnectionOptions}
      />

      {connections.length > 0 && (
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
