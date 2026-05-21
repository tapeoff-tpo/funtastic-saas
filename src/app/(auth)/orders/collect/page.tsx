import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { excelImportTemplates, marketplaceConnections } from '@/lib/db/schema'
import { getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import { DEFAULT_ORDER_IMPORT_TEMPLATES } from '@/lib/orders/default-import-templates'
import { MarketplaceDashboard } from '@/components/marketplace/marketplace-dashboard'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '주문 수집',
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

export default async function OrdersCollectPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const workspaceUserId = await getWorkspaceUserId(user.id)

  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.userId, workspaceUserId))

  const userImportTemplates = await db
    .select({
      id: excelImportTemplates.id,
      name: excelImportTemplates.name,
      mappings: excelImportTemplates.mappings,
      isDefault: excelImportTemplates.isDefault,
    })
    .from(excelImportTemplates)
    .where(eq(excelImportTemplates.userId, workspaceUserId))

  const userTemplateNames = new Set(userImportTemplates.map((template) => template.name))
  const importTemplates = [
    ...userImportTemplates,
    ...DEFAULT_ORDER_IMPORT_TEMPLATES.filter((template) => !userTemplateNames.has(template.name)),
  ]

  const dashboardConnections = connections
    .filter((c) => !isDomechangoManualConnection(c))
    .filter((c) => c.status !== 'disconnected')
    .map((c) => ({
      id: c.id,
      marketplaceId: c.marketplaceId,
      displayName: c.displayName,
      status: c.status,
      lastCheckedAt: c.lastCheckedAt,
      lastErrorMessage: c.lastErrorMessage,
      expiresAt: c.expiresAt,
      isManual: c.isManual,
      integrationMethod: getIntegrationMethod(c.marketplaceId, {
        isManual: c.isManual,
        authType: c.authType,
      }),
      linkedMarketplaces: linkedMarketplacesFromMetadata(c.metadata),
    }))

  return (
    <div>
      <MarketplaceDashboard
        connections={dashboardConnections}
        importTemplates={importTemplates}
      />
    </div>
  )
}
