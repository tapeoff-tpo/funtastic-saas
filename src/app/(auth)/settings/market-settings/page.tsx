import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
import { listMarketplaceBusinessSettings } from '@/lib/marketplace/business-settings'
import '@/lib/marketplace/adapters/configs'
import { MarketSettingsList, type MarketSettingsItem } from './market-settings-list'

export const metadata: Metadata = {
  title: '마켓설정',
}

export default async function MarketSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [connections, commonSettings] = await Promise.all([
    db.select().from(marketplaceConnections).where(eq(marketplaceConnections.userId, workspaceUserId)),
    listMarketplaceBusinessSettings(workspaceUserId),
  ])

  const configs = marketplaceRegistry.listConfigs()
  const marketplaceNames = new Map(configs.map((config) => [config.id, config.name]))
  const connectedMarketplaceIds = new Set(connections.map((connection) => connection.marketplaceId))
  const commonSettingsByMarketplace = new Map(commonSettings.map((setting) => [setting.marketplaceId, setting]))
  const connectionRows: MarketSettingsItem[] = connections
    .filter((connection) => !isDomechangoManualConnection(connection))
    .map((connection) => ({
      id: connection.id,
      marketplaceId: connection.marketplaceId,
      marketplaceName: marketplaceNames.get(connection.marketplaceId) ?? connection.displayName,
      storeAlias: connection.storeAlias,
      displayName: connection.displayName,
      systemMarketplaceName: textMetadata(connection.metadata, 'systemMarketplaceName'),
      salesExportMarketplaceId: textMetadata(connection.metadata, 'salesExportMarketplaceId'),
      salesFeePercent: parseSalesFeePercentForInput(connection.metadata?.salesFeePercent),
      linkedMarketplaces: linkedMarketplacesFromMetadata(connection.metadata),
      isCommon: false,
    }))
  const commonRows: MarketSettingsItem[] = configs
    .filter((config) => !connectedMarketplaceIds.has(config.id))
    .map((config) => {
      const setting = commonSettingsByMarketplace.get(config.id)
      return {
        id: `common:${config.id}`,
        marketplaceId: config.id,
        marketplaceName: config.name,
        storeAlias: '',
        displayName: config.name,
        systemMarketplaceName: setting?.systemMarketplaceName ?? '',
        salesExportMarketplaceId: setting?.salesExportMarketplaceId ?? '',
        salesFeePercent: setting?.salesFeePercent ?? '',
        linkedMarketplaces: [],
        isCommon: true,
      }
    })
  const knownMarketplaceIds = new Set(configs.map((config) => config.id))
  const customRows: MarketSettingsItem[] = commonSettings
    .filter((setting) => !knownMarketplaceIds.has(setting.marketplaceId) && !connectedMarketplaceIds.has(setting.marketplaceId))
    .map((setting) => ({
      id: `common:${setting.marketplaceId}`,
      marketplaceId: setting.marketplaceId,
      marketplaceName: setting.systemMarketplaceName || setting.marketplaceId,
      storeAlias: '',
      displayName: setting.systemMarketplaceName || setting.marketplaceId,
      systemMarketplaceName: setting.systemMarketplaceName,
      salesExportMarketplaceId: setting.salesExportMarketplaceId,
      salesFeePercent: setting.salesFeePercent,
      linkedMarketplaces: [],
      isCommon: true,
      isCustom: true,
    }))
  const rows = [...connectionRows, ...commonRows, ...customRows]
    .sort((a, b) => a.marketplaceName.localeCompare(b.marketplaceName, 'ko-KR') || a.storeAlias.localeCompare(b.storeAlias, 'ko-KR'))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">마켓설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          주문관리·매출분석·매출확인용 엑셀에서 사용할 마켓 표시명, 아이디, 수수료율을 관리합니다.
        </p>
      </div>
      <MarketSettingsList connections={rows} />
    </div>
  )
}

function textMetadata(metadata: Record<string, unknown> | null, key: string): string {
  return typeof metadata?.[key] === 'string' ? metadata[key].trim() : ''
}

function parseSalesFeePercentForInput(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? trimmed : ''
}

function linkedMarketplacesFromMetadata(metadata: Record<string, unknown> | null): string[] {
  const value = metadata?.linkedMarketplaces
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : []
}

function isDomechangoManualConnection(connection: typeof marketplaceConnections.$inferSelect): boolean {
  const displayNameKey = connection.displayName.replace(/\s+/g, '')
  return connection.isManual && (connection.marketplaceId === 'domechango' || displayNameKey.includes('도매창고'))
}
