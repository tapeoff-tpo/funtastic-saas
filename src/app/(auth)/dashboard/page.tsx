import Link from 'next/link'
import { eq, and, ne, inArray, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { marketplaceConnections, orders, orderItems, productNameMappings, products, productVariants } from '@/lib/db/schema'
import { MarketplaceDashboard } from '@/components/marketplace/marketplace-dashboard'
import { Package, AlertTriangle, ShoppingCart } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const connections = await db
    .select()
    .from(marketplaceConnections)
    .where(eq(marketplaceConnections.userId, user.id))

  // Compute workflow stats — pending actions
  const [
    newOrdersResult,
    activeOrdersForMapping,
    mappings,
    productSkus,
    variantSkus,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, user.id), eq(orders.status, 'new'))),
    db.select({ id: orders.id, marketplaceId: orders.marketplaceId })
      .from(orders)
      .where(and(
        eq(orders.userId, user.id),
        ne(orders.status, 'cancelled'),
        ne(orders.status, 'delivered'),
      )),
    db.select({
      marketplaceId: productNameMappings.marketplaceId,
      marketplaceName: productNameMappings.marketplaceName,
    }).from(productNameMappings).where(eq(productNameMappings.userId, user.id)),
    db.select({ sku: products.internalSku })
      .from(products)
      .where(eq(products.userId, user.id)),
    db.select({ sku: productVariants.sku })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(eq(products.userId, user.id)),
  ])

  const newOrderCount = newOrdersResult[0]?.count ?? 0

  // Count orders with unmapped items
  let unmappedOrderCount = 0
  if (activeOrdersForMapping.length > 0) {
    const activeOrderIds = activeOrdersForMapping.map((o) => o.id)
    const items = await db
      .select({ orderId: orderItems.orderId, productName: orderItems.productName, sku: orderItems.sku })
      .from(orderItems)
      .where(inArray(orderItems.orderId, activeOrderIds))

    const nameKeys = new Set(mappings.map((m) => `${m.marketplaceId}::${m.marketplaceName}`))
    const skuSet = new Set<string>()
    for (const p of productSkus) skuSet.add(p.sku)
    for (const v of variantSkus) skuSet.add(v.sku)

    const orderMarketMap = new Map(activeOrdersForMapping.map((o) => [o.id, o.marketplaceId]))
    const itemsByOrder = new Map<string, typeof items>()
    for (const i of items) {
      const arr = itemsByOrder.get(i.orderId) ?? []
      arr.push(i)
      itemsByOrder.set(i.orderId, arr)
    }

    for (const [orderId, orderItemsList] of itemsByOrder) {
      const mid = orderMarketMap.get(orderId) ?? ''
      const hasUnmapped = orderItemsList.some((item) => {
        const nameMatch = nameKeys.has(`${mid}::${item.productName}`)
        const skuMatch = item.sku ? skuSet.has(item.sku.trim()) : false
        return !nameMatch && !skuMatch
      })
      if (hasUnmapped) unmappedOrderCount++
    }
  }

  if (connections.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">마켓플레이스 연동 현황</h1>
        <div className="mt-8 rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <p className="text-muted-foreground">
            아직 연결된 마켓플레이스가 없습니다.
          </p>
          <Link
            href="/settings/marketplaces"
            className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            마켓플레이스 연동하기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Workflow stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link
          href="/orders?status=new"
          className="rounded-lg border bg-white p-4 transition-colors hover:border-blue-400 hover:bg-blue-50/30"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground">신규 주문</p>
              <p className="mt-1 text-2xl font-bold">{newOrderCount.toLocaleString('ko-KR')}</p>
              <p className="mt-1 text-xs text-muted-foreground">발주확인 대기</p>
            </div>
            <ShoppingCart className="h-5 w-5 text-blue-500" />
          </div>
        </Link>

        <Link
          href="/orders?mapping=unmapped"
          className={`rounded-lg border bg-white p-4 transition-colors ${
            unmappedOrderCount > 0
              ? 'border-red-200 hover:border-red-400 hover:bg-red-50/30'
              : 'hover:border-gray-400'
          }`}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground">미매핑 주문</p>
              <p className={`mt-1 text-2xl font-bold ${unmappedOrderCount > 0 ? 'text-red-600' : ''}`}>
                {unmappedOrderCount.toLocaleString('ko-KR')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">매핑 필요</p>
            </div>
            <AlertTriangle className={`h-5 w-5 ${unmappedOrderCount > 0 ? 'text-red-500' : 'text-gray-400'}`} />
          </div>
        </Link>

        <Link
          href="/products"
          className="rounded-lg border bg-white p-4 transition-colors hover:border-gray-400"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground">상품 관리</p>
              <p className="mt-1 text-2xl font-bold">{productSkus.length.toLocaleString('ko-KR')}</p>
              <p className="mt-1 text-xs text-muted-foreground">등록된 상품</p>
            </div>
            <Package className="h-5 w-5 text-gray-500" />
          </div>
        </Link>
      </div>

      <MarketplaceDashboard
        connections={connections.map((c) => ({
          marketplaceId: c.marketplaceId,
          displayName: c.displayName,
          status: c.status,
          lastCheckedAt: c.lastCheckedAt,
          lastErrorMessage: c.lastErrorMessage,
          expiresAt: c.expiresAt,
          isManual: c.isManual,
        }))}
      />
    </div>
  )
}
