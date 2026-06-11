import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections } from '@/lib/db/schema'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { marketplaceRegistry } from '@/lib/marketplace/registry'
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
  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.userId, workspaceUserId))

  const marketplaceNames = new Map(marketplaceRegistry.listConfigs().map((config) => [config.id, config.name]))
  const rows: MarketSettingsItem[] = connections
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
    }))
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
