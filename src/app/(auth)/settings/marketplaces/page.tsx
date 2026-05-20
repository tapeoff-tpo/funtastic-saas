import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { getIntegrationInfo, getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import '@/lib/marketplace/adapters/configs'
import { CredentialForm } from '@/components/marketplace/credential-form'
import { IntegrationForms } from '@/components/marketplace/integration-forms'
import { ConnectionRow } from './edit-button'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import type { ConnectionStatus } from '@/lib/marketplace/types'
import type { IntegrationMethod } from '@/lib/marketplace/integration-methods'

interface ConnectionListItem {
  id: string
  displayName: string
  status: string
}

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

  const connectedIds = new Set(connections.map((c) => c.marketplaceId))
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
    isConnected: connectedIds.has(config.id),
    integrationMethod: getIntegrationMethod(config.id, { authType: config.authType }),
  }))
  const apiMarketplaceOptions = catalog
    .filter((marketplace) => marketplace.integrationMethod === 'api')
    .map((marketplace) => ({
      id: marketplace.id,
      name: marketplace.name,
      requiredCredentials: marketplace.requiredCredentials,
      isConnected: marketplace.isConnected,
    }))
  const hubMarketplaceOptions = catalog
    .filter((marketplace) => marketplace.integrationMethod === 'hub')
    .map((marketplace) => ({
      id: marketplace.id,
      name: marketplace.name,
      requiredCredentials: marketplace.requiredCredentials,
      isConnected: marketplace.isConnected,
    }))
  const rpaOptions = catalog.filter((marketplace) => marketplace.integrationMethod === 'rpa')
  const rpaConnectionOptions = rpaOptions.map((marketplace) => ({
    id: marketplace.id,
    name: marketplace.name,
    isConnected: connectedMethodIds.has(`rpa:${marketplace.id}`),
  }))
  const excelConnectionOptions = catalog.map((marketplace) => ({
    id: marketplace.id,
    name: marketplace.name,
    isConnected: connectedMethodIds.has(`excel:${marketplace.id}`),
  }))
  const groupedConnections = {
    api: connections.filter((connection) =>
      getIntegrationMethod(connection.marketplaceId, {
        isManual: connection.isManual,
        authType: connection.authType,
      }) === 'api'
    ),
    hub: connections.filter((connection) =>
      getIntegrationMethod(connection.marketplaceId, {
        isManual: connection.isManual,
        authType: connection.authType,
      }) === 'hub'
    ),
    rpa: connections.filter((connection) =>
      getIntegrationMethod(connection.marketplaceId, {
        isManual: connection.isManual,
        authType: connection.authType,
      }) === 'rpa'
    ),
    excel: connections.filter((connection) =>
      getIntegrationMethod(connection.marketplaceId, {
        isManual: connection.isManual,
        authType: connection.authType,
      }) === 'excel'
    ),
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">마켓플레이스 연동 설정</h1>
        <p className="mt-1 text-muted-foreground">
          공식 API, RPA 자동화, 엑셀 수동 업로드를 분리해서 관리합니다.
        </p>
      </div>

      <CredentialForm
        title="API 연동"
        description="공식 API로 직접 연결하는 마켓을 등록합니다."
        selectLabel="API 마켓"
        marketplaces={apiMarketplaceOptions}
        pageSize={10}
      />

      <IntegrationForms
        rpaMarketplaces={rpaConnectionOptions}
        excelMarketplaces={excelConnectionOptions}
      />

      <CredentialForm
        title="허브연동"
        description="여러 쇼핑몰 주문을 모아주는 허브 서비스를 등록합니다."
        selectLabel="허브"
        marketplaces={hubMarketplaceOptions}
        pageSize={10}
      />

      {connections.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">연결된 마켓플레이스</h2>
          <div className="grid gap-4 lg:grid-cols-3">
            <ConnectionGroup title="API 연동" method="api" connections={groupedConnections.api} />
            <ConnectionGroup title="허브 연동" method="hub" connections={groupedConnections.hub} />
            <ConnectionGroup title="RPA 연동" method="rpa" connections={groupedConnections.rpa} />
            <ConnectionGroup title="엑셀 업로드" method="excel" connections={groupedConnections.excel} />
          </div>
        </div>
      )}
    </div>
  )
}

function ConnectionGroup({
  title,
  method,
  connections,
}: {
  title: string
  method: IntegrationMethod
  connections: ConnectionListItem[]
}) {
  const info = getIntegrationInfo(method)

  return (
    <section className="overflow-hidden rounded-lg border bg-white">
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{info.description}</p>
          </div>
          <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {connections.length}개
          </span>
        </div>
      </div>
      {connections.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          등록된 연결이 없습니다.
        </div>
      ) : (
        <div className="divide-y">
          {connections.map((conn) => (
            <ConnectionRow
              key={conn.id}
              connectionId={conn.id}
              displayName={conn.displayName}
              status={conn.status as ConnectionStatus}
              integrationMethod={method}
            />
          ))}
        </div>
      )}
    </section>
  )
}
