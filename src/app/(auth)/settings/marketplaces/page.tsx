import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { getIntegrationInfo, getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import '@/lib/marketplace/adapters/configs'
import { CredentialForm } from '@/components/marketplace/credential-form'
import { ConnectionRow } from './edit-button'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import type { ConnectionStatus } from '@/lib/marketplace/types'

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

  const catalog = configs.map((config) => ({
    id: config.id,
    name: config.name,
    requiredCredentials: [...config.requiredCredentials],
    isConnected: connectedIds.has(config.id),
    integrationMethod: getIntegrationMethod(config.id, { authType: config.authType }),
  }))
  const marketplaceOptions = catalog
    .filter((marketplace) => marketplace.integrationMethod === 'api')
    .map((marketplace) => ({
      id: marketplace.id,
      name: marketplace.name,
      requiredCredentials: marketplace.requiredCredentials,
      isConnected: marketplace.isConnected,
    }))
  const rpaOptions = catalog.filter((marketplace) => marketplace.integrationMethod === 'rpa')
  const rpaInfo = getIntegrationInfo('rpa')
  const excelInfo = getIntegrationInfo('excel')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">마켓플레이스 연동 설정</h1>
        <p className="mt-1 text-muted-foreground">
          공식 API, RPA 자동화, 엑셀 수동 업로드를 분리해서 관리합니다.
        </p>
      </div>

      <CredentialForm marketplaces={marketplaceOptions} />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{rpaInfo.label} 자동화 후보</h2>
              <p className="mt-1 text-sm text-muted-foreground">{rpaInfo.description}</p>
            </div>
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
              {rpaOptions.length}개
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {rpaOptions.map((marketplace) => (
              <span
                key={marketplace.id}
                className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground"
              >
                {marketplace.name}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-white p-4">
          <h2 className="text-base font-semibold">{excelInfo.label} 수동 업로드</h2>
          <p className="mt-1 text-sm text-muted-foreground">{excelInfo.description}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            온채널처럼 공식 API가 없거나 RPA가 불안정한 채널은 주문수집 화면에서 엑셀 양식을 선택해 업로드합니다.
          </p>
        </section>
      </div>

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
