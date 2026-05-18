import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { excelImportTemplates, marketplaceConnections } from '@/lib/db/schema'
import { AUTO_MARKETPLACE_OPTIONS } from '@/lib/marketplace/collect-options'
import { getIntegrationMethod } from '@/lib/marketplace/integration-methods'
import { DEFAULT_ORDER_IMPORT_TEMPLATES } from '@/lib/orders/default-import-templates'
import { MarketplaceDashboard } from '@/components/marketplace/marketplace-dashboard'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '주문 수집',
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

  const connectionRows = connections.map((c) => ({
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
  }))

  const existingAutoMarketplaceIds = new Set(
    connectionRows.filter((c) => !c.isManual).map((c) => c.marketplaceId)
  )

  const dashboardConnections = [
    ...connectionRows,
    ...AUTO_MARKETPLACE_OPTIONS
      .filter((marketplace) => !existingAutoMarketplaceIds.has(marketplace.marketplaceId))
      .map((marketplace) => ({
        id: `auto-placeholder-${marketplace.marketplaceId}`,
        marketplaceId: marketplace.marketplaceId,
        displayName: marketplace.displayName,
        status: 'disconnected',
        lastCheckedAt: null,
        lastErrorMessage: null,
        expiresAt: null,
        isManual: false,
        integrationMethod: getIntegrationMethod(marketplace.marketplaceId),
      })),
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">주문 수집</h1>
      <MarketplaceDashboard
        connections={dashboardConnections}
        importTemplates={importTemplates}
      />
    </div>
  )
}
