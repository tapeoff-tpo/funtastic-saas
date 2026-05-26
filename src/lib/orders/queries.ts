/**
 * Order queries with server-side filtering and pagination.
 *
 * Used by the dashboard to list, filter, and paginate orders.
 * All queries run server-side (offset/limit pagination acceptable for admin tool).
 */

import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { orders, orderItems, claims, shipments, orderMemos, products, productVariants, inventory, shipmentGroups, shipmentGroupOrders, scanLogs, mappingSources, mappingComponents } from '@/lib/db/schema'
import { eq, and, or, ilike, gte, lte, desc, asc, sql, count, countDistinct, inArray, notInArray, isNotNull, isNull, exists } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { OrderFilters, MappingStatus, OrderStage, OrderStats } from './types'
// re-export so existing imports `import { OrderStats } from '@/lib/orders/queries'` keep working
export type { OrderStats }
import { listInquiriesByOrderIds } from './inquiry-queries'
import { buildMappingIndex, EXACT_OPTION_ID, lookupMappingRef, type MappingSource } from './mapping-match'
import { getOrderChangeLogs } from './change-log'
import { resolveMarketplaceDisplayName } from '@/lib/marketplace/collect-options'

/**
 * mappingStatus/displayName 계산용 매핑 조회.
 *
 * 매핑은 신규탭에서 바로 수정되는 작업 데이터라 서버 캐시를 타면 방금 고친 매핑이
 * 주문 목록에 남아 보일 수 있다. 주문 화면은 항상 최신 mapping_sources/components 를 읽는다.
 */
async function getMappingLookups(
  userId: string,
  candidates: {
    skus: string[]
    marketplaceProductIds: string[]
  },
) {
  const skus = Array.from(new Set(candidates.skus.map((sku) => sku.trim()).filter(Boolean)))
  const marketplaceProductIds = Array.from(
    new Set(candidates.marketplaceProductIds.map((id) => id.trim()).filter(Boolean)),
  )

  const [productSkus, variantSkus, sources] = await Promise.all([
    skus.length > 0
      ? db
          .select({ sku: products.internalSku })
          .from(products)
          .where(and(eq(products.userId, userId), inArray(products.internalSku, skus)))
      : Promise.resolve([] as Array<{ sku: string }>),
    skus.length > 0
      ? db
          .select({ sku: productVariants.sku })
          .from(productVariants)
          .innerJoin(products, eq(productVariants.productId, products.id))
          .where(and(eq(products.userId, userId), inArray(productVariants.sku, skus)))
      : Promise.resolve([] as Array<{ sku: string }>),
    marketplaceProductIds.length > 0
      ? db
          .select({
            mappingCodeId: mappingSources.mappingCodeId,
            marketplaceId: mappingSources.marketplaceId,
            marketplaceProductId: mappingSources.marketplaceProductId,
            marketplaceOptionId: mappingSources.marketplaceOptionId,
          })
          .from(mappingSources)
          .where(
            and(
              eq(mappingSources.userId, userId),
              inArray(mappingSources.marketplaceProductId, marketplaceProductIds),
            ),
          )
      : Promise.resolve([] as Array<{
          mappingCodeId: string
          marketplaceId: string
          marketplaceProductId: string
          marketplaceOptionId: string
        }>),
  ])

  const mappingCodeIds = Array.from(new Set(sources.map((source) => source.mappingCodeId)))
  const componentRows = mappingCodeIds.length > 0
    ? await db
        .select({
          mappingCodeId: mappingComponents.mappingCodeId,
          sku: mappingComponents.sku,
          quantity: mappingComponents.quantity,
        })
        .from(mappingComponents)
        .where(
          and(
            eq(mappingComponents.userId, userId),
            inArray(mappingComponents.mappingCodeId, mappingCodeIds),
          ),
        )
    : []

  const componentSkus = Array.from(new Set(componentRows.map((component) => component.sku)))
  const inventoryRows = componentSkus.length > 0
    ? await db
        .select({
          sku: inventory.sku,
          productName: sql<string | null>`MAX(${inventory.productName})`,
          optionName: sql<string | null>`MAX(${inventory.optionName})`,
          availableStock: sql<number | null>`COALESCE(SUM(${inventory.availableStock}), 0)::int`,
        })
        .from(inventory)
        .where(and(eq(inventory.userId, userId), inArray(inventory.sku, componentSkus)))
        .groupBy(inventory.sku)
    : []
  const inventoryBySku = new Map(inventoryRows.map((row) => [row.sku, row]))

  const components = componentRows.map((component) => {
    const inv = inventoryBySku.get(component.sku)
    return {
      ...component,
      productName: inv?.productName ?? null,
      optionName: inv?.optionName ?? null,
      availableStock: inv?.availableStock ?? null,
    }
  })

  return { productSkus, variantSkus, sources, components }
}

/**
 * perf: getOrderStats 는 5개 병렬 COUNT 쿼리. 탭 전환 사이엔 값이 거의 안 변함.
 * 30초 캐시 + 주문 변경 시 `revalidateTag('orders')` 로 무효화.
 */
const getOrderStatsCached = unstable_cache(
  async (userId: string): Promise<OrderStats> => getOrderStatsImpl(userId),
  ['order-stats'],
  { revalidate: 30, tags: ['orders'] },
)

/** 주문이 특정 단계에 속하는지 판정 */
export function matchStage(
  order: {
    status: string
    mappingStatus: MappingStatus
    trackingNumber: string | null
  },
  stage: OrderStage,
): boolean {
  const s = order.status
  const isActive = s !== 'cancelled' && s !== 'delivered'
  switch (stage) {
    case 'prep':
      // 출고 준비 = 매핑 필요 ∪ 확정 대기
      return (
        (isActive && order.mappingStatus !== 'mapped') ||
        (s === 'new' && order.mappingStatus === 'mapped')
      )
    case 'mapping':
      return isActive && order.mappingStatus !== 'mapped'
    case 'confirm':
      return s === 'new' && order.mappingStatus === 'mapped'
    case 'invoice':
      return s === 'confirmed' && !order.trackingNumber
    case 'shipping':
      return (s === 'preparing' || s === 'confirmed') && !!order.trackingNumber
    case 'done':
      return s === 'shipped' || s === 'delivering' || s === 'delivered'
    default:
      return true
  }
}

const DEFAULT_PAGE_SIZE = 50
const INACTIVE_CLAIM_STATUSES = ['rejected', 'withdrawn'] as const
const CLAIM_LIKE_MARKETPLACE_STATUS_PATTERN = '^(\uCDE8\uC18C|\uBC18\uD488|\uAD50\uD658)'
const INACTIVE_MARKETPLACE_CLAIM_STATUS_PATTERN = '(\uAC70\uC808|\uAC70\uBD80|\uBC18\uB824|\uCCA0\uD68C)'

function expandSkuSearchTerms(skus: string[]): string[] {
  const terms = new Set<string>()
  for (const rawSku of skus) {
    const sku = rawSku.trim()
    if (!sku) continue
    terms.add(sku)
    const baseSku = sku.replace(/-\d+$/, '')
    if (baseSku && baseSku !== sku) terms.add(baseSku)
  }
  return [...terms]
}

function parseSearchTerms(search: string): string[] {
  return Array.from(new Set(
    search
      .split(/[\n\r,;，、\t]+/)
      .map((term) => term.trim())
      .filter(Boolean),
  )).slice(0, 50)
}

async function getConfirmedProductSearchSkus(userId: string, search: string): Promise<string[]> {
  const terms = parseSearchTerms(search)
  if (terms.length === 0) return []
  const productNameConditions = terms.map((term) => ilike(products.name, `%${term}%`))
  const inventoryNameConditions = terms.map((term) => ilike(inventory.productName, `%${term}%`))

  const [productRows, inventoryRows] = await Promise.all([
    db
      .select({ sku: products.internalSku })
      .from(products)
      .where(and(eq(products.userId, userId), or(...productNameConditions)!))
      .limit(500),
    db
      .select({ sku: inventory.sku })
      .from(inventory)
      .where(and(eq(inventory.userId, userId), or(...inventoryNameConditions)!))
      .groupBy(inventory.sku)
      .limit(500),
  ])

  return expandSkuSearchTerms([
    ...productRows.map((row) => row.sku),
    ...inventoryRows.map((row) => row.sku),
  ])
}

function getOrderMarketplaceDisplayName(order: typeof orders.$inferSelect): string | null {
  const rawData = order.rawData
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null
  const data = rawData as {
    mallName?: unknown
    empSiteName?: unknown
    SiteName?: unknown
    siteName?: unknown
    sabangnetRaw?: unknown
    sabangnetSync?: unknown
    empSiteCode?: unknown
    SiteCode?: unknown
    empSiteId?: unknown
    SiteId?: unknown
  }
  const sabangnetRaw = data.sabangnetRaw && typeof data.sabangnetRaw === 'object' && !Array.isArray(data.sabangnetRaw)
    ? data.sabangnetRaw as { 쇼핑몰명?: unknown }
    : null
  const sabangnetSync = data.sabangnetSync && typeof data.sabangnetSync === 'object' && !Array.isArray(data.sabangnetSync)
    ? data.sabangnetSync as { mallName?: unknown }
    : null
  const candidates = [
    sabangnetRaw?.쇼핑몰명,
    sabangnetSync?.mallName,
    data.mallName,
    data.empSiteName,
    data.SiteName,
    data.siteName,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed === '사방넷' || trimmed.toLowerCase() === 'sabangnet') continue
    if (trimmed.length > 0) return resolveMarketplaceDisplayName(order.marketplaceId, trimmed)
  }

  const siteCode = typeof data.empSiteCode === 'string' ? data.empSiteCode : data.SiteCode
  const siteId = typeof data.empSiteId === 'string' ? data.empSiteId : data.SiteId
  const fallback = [siteCode, siteId]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
    .join(' / ')
  return fallback.length > 0 ? fallback : resolveMarketplaceDisplayName(order.marketplaceId)
}

function isAblyOrderRawData(rawData: Record<string, unknown>): boolean {
  const candidates = [rawData.mallName, rawData.empSiteName, rawData.SiteName, rawData.siteName, rawData.empSiteCode, rawData.SiteCode]
  return candidates.some((candidate) => {
    if (typeof candidate !== 'string') return false
    const value = candidate.toLowerCase()
    return value.includes('ably') || value.includes('\uC5D0\uC774\uBE14\uB9AC')
  })
}

function normalizeAblyDisplayOrderId(orderId: string, rawData: Record<string, unknown>): string {
  if (!isAblyOrderRawData(rawData)) return orderId

  const numericGroups = orderId.match(/\d+/g) ?? []
  if (numericGroups[0] && numericGroups[0].length >= 10) return numericGroups[0]

  const digitsOnly = orderId.replace(/\D/g, '')
  if (digitsOnly.length > 13) return digitsOnly.slice(0, 13)
  return orderId
}

function getOrderMarketplaceOrderDisplayId(order: typeof orders.$inferSelect): string {
  const rawData = order.rawData
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return order.marketplaceOrderId
  const original = (rawData as { originalMarketplaceOrderId?: unknown }).originalMarketplaceOrderId
  const candidate = typeof original === 'string' && original.trim().length > 0
    ? original.trim()
    : order.marketplaceOrderId
  return normalizeAblyDisplayOrderId(candidate, rawData as Record<string, unknown>)
}

function getOrderHistoricalClaimStatuses(order: typeof orders.$inferSelect): string[] {
  const rawData = order.rawData
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return []
  const rows = (rawData as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return []

  const statuses = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const raw = (row as { raw?: unknown }).raw
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const status = (raw as { 주문상태?: unknown }).주문상태
    if (typeof status !== 'string') continue
    const trimmed = status.trim()
    if (/^(취소|반품|교환)/.test(trimmed)) statuses.add(trimmed)
  }
  return [...statuses].sort((a, b) => a.localeCompare(b, 'ko'))
}

function parseKstDateBoundary(value: string, boundary: 'start' | 'end'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value)
  const time = boundary === 'start' ? '00:00:00.000' : '23:59:59.999'
  return new Date(`${value}T${time}+09:00`)
}

function getDateFilterCondition(
  filters: OrderFilters,
  value: string,
  boundary: 'start' | 'end',
): SQL {
  const date = parseKstDateBoundary(value, boundary)
  if (filters.dateField === 'shippedAt') {
    const shippedAtExpr = sql<Date | null>`COALESCE(
      (
        SELECT MAX(${shipments.shippedAt})
        FROM ${shipments}
        WHERE ${shipments.orderId} = ${orders.id}
      ),
      CASE
        WHEN ${orders.status} IN ('shipped', 'delivering', 'delivered')
        THEN ${orders.updatedAt}
        ELSE NULL
      END
    )`
    return boundary === 'start'
      ? sql`${shippedAtExpr} >= ${date}`
      : sql`${shippedAtExpr} <= ${date}`
  }

  const dateColumn = filters.dateField === 'collectedAt' ? orders.collectedAt : orders.orderedAt
  return boundary === 'start'
    ? gte(dateColumn, date)
    : lte(dateColumn, date)
}

/**
 * Build WHERE clause conditions from filters.
 * Exported for testability.
 */
export function buildOrderWhereClause(filters: OrderFilters): SQL[] {
  const conditions: SQL[] = []
  const isSabangnetOrderSource = sql`(
    COALESCE(${orders.rawData}->>'source', '') LIKE 'sabangnet-%'
    OR ${orders.marketplaceId} LIKE 'sabangnet-%'
    OR ${orders.rawData} ? 'sabangnetSync'
    OR ${orders.rawData} ? 'sabangnetRaw'
  )`

  if (filters.userId) {
    conditions.push(eq(orders.userId, filters.userId))
  }

  if (filters.status) {
    conditions.push(eq(orders.status, filters.status))
  } else if (filters.statuses?.length) {
    conditions.push(inArray(orders.status, filters.statuses))
  }

  if (filters.marketplaces?.length) {
    conditions.push(inArray(orders.marketplaceId, filters.marketplaces))
  } else if (filters.marketplace) {
    conditions.push(eq(orders.marketplaceId, filters.marketplace))
  }

  if (filters.mapping === 'mapped') {
    conditions.push(isNotNull(orders.mappedAt))
  } else if (filters.mapping === 'unmapped') {
    conditions.push(isNull(orders.mappedAt))
  }

  if (filters.orderSource === 'sabangnet') {
    conditions.push(isSabangnetOrderSource)
  } else if (filters.orderSource === 'saas') {
    conditions.push(sql`NOT ${isSabangnetOrderSource}`)
  }

  if (filters.dateFrom) {
    conditions.push(getDateFilterCondition(filters, filters.dateFrom, 'start'))
  }

  if (filters.dateTo) {
    conditions.push(getDateFilterCondition(filters, filters.dateTo, 'end'))
  }

  if (filters.search) {
    const searchTerms = parseSearchTerms(filters.search)
    const searchField = filters.searchField ?? 'all'
    const itemExists = (condition: SQL<unknown>) => exists(
      db
        .select({ x: sql`1` })
        .from(orderItems)
        .where(and(eq(orderItems.orderId, orders.id), condition)),
    )
    const confirmedProductExists = filters.confirmedProductSearchSkus?.length
      ? itemExists(inArray(orderItems.sku, filters.confirmedProductSearchSkus))
      : sql`false`

    const buildSearchCondition = (term: string): SQL<unknown> | undefined => {
      const searchPattern = `%${term}%`
      const internalNoPattern = `%${term.replace(/^#/, '')}%`
      const trackingExists = exists(
        db
          .select({ x: sql`1` })
          .from(shipments)
          .where(
            and(
              eq(shipments.orderId, orders.id),
              ilike(shipments.trackingNumber, searchPattern),
            ),
          ),
      )

      switch (searchField) {
        case 'buyerName':
          return ilike(orders.buyerName, searchPattern)
        case 'recipientName':
          return ilike(orders.recipientName, searchPattern)
        case 'marketplaceOrderId':
          return ilike(orders.marketplaceOrderId, searchPattern)
        case 'internalNo':
          return ilike(orders.internalNo, internalNoPattern)
        case 'sku':
          return itemExists(ilike(orderItems.sku, searchPattern))
        case 'marketplaceProductCode':
          return itemExists(ilike(orderItems.marketplaceItemId, searchPattern))
        case 'collectedProductName':
          return itemExists(ilike(orderItems.productName, searchPattern))
        case 'confirmedProductName':
          return confirmedProductExists
        case 'recipientPhone':
          return ilike(orders.recipientPhone, searchPattern)
        case 'recipientPhone2':
          return ilike(orders.recipientPhone2, searchPattern)
        case 'buyerPhone':
          return ilike(orders.buyerPhone, searchPattern)
        case 'buyerPhone2':
          return ilike(orders.buyerPhone2, searchPattern)
        case 'trackingNumber':
          return trackingExists
        case 'logisticsMessage':
          return ilike(orders.logisticsMessage, searchPattern)
        case 'all':
        default:
          return or(
            ilike(orders.marketplaceOrderId, searchPattern),
            ilike(orders.internalNo, internalNoPattern),
            ilike(orders.buyerName, searchPattern),
            ilike(orders.buyerPhone, searchPattern),
            ilike(orders.buyerPhone2, searchPattern),
            ilike(orders.recipientName, searchPattern),
            ilike(orders.recipientPhone, searchPattern),
            ilike(orders.recipientPhone2, searchPattern),
            ilike(orders.logisticsMessage, searchPattern),
            itemExists(ilike(orderItems.marketplaceItemId, searchPattern)),
            itemExists(ilike(orderItems.sku, searchPattern)),
            itemExists(ilike(orderItems.productName, searchPattern)),
            confirmedProductExists,
            trackingExists,
          )
      }
    }

    const searchConditions = searchTerms
      .map(buildSearchCondition)
      .filter((condition): condition is SQL<unknown> => Boolean(condition))
    if (searchConditions.length > 0) conditions.push(or(...searchConditions)!)
  }

  if (filters.isHeld) {
    conditions.push(eq(orders.isHeld, true))
  } else if (filters.excludeHeld) {
    conditions.push(eq(orders.isHeld, false))
  }

  if (filters.scan) {
    const scanExists = exists(
      db
        .select({ x: sql`1` })
        .from(scanLogs)
        .where(and(eq(scanLogs.orderId, orders.id), isNotNull(scanLogs.orderId))),
    )

    if (filters.scan === 'scanned') {
      conditions.push(scanExists)
    } else if (filters.scan === 'unscanned') {
      conditions.push(sql`NOT EXISTS (
        SELECT 1
        FROM ${scanLogs}
        WHERE ${scanLogs.orderId} = ${orders.id}
      )`)
    }
  }

  if (filters.scanResult) {
    conditions.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(scanLogs)
          .where(and(eq(scanLogs.orderId, orders.id), eq(scanLogs.status, filters.scanResult))),
      ),
    )
  }

  if (filters.claimType) {
    conditions.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(claims)
          .where(and(
            eq(claims.orderId, orders.id),
            eq(claims.claimType, filters.claimType),
            notInArray(claims.claimStatus, [...INACTIVE_CLAIM_STATUSES]),
          )),
      ),
    )
  }

  // Phase 8 — 취소 탭 통합 필터: status='cancelled' OR claimType='cancel'
  if (filters.cancelTab) {
    conditions.push(
      or(
        eq(orders.status, 'cancelled'),
        exists(
          db
            .select({ x: sql`1` })
            .from(claims)
            .where(
              and(
                eq(claims.orderId, orders.id),
                eq(claims.claimType, 'cancel'),
                notInArray(claims.claimStatus, [...INACTIVE_CLAIM_STATUSES]),
              ),
            ),
        ),
      )!,
    )
  }

  if (filters.excludeClaimLikeOrders) {
    conditions.push(
      sql`NOT EXISTS (
        SELECT 1
        FROM ${claims}
        WHERE ${claims.orderId} = ${orders.id}
          AND ${claims.claimStatus} NOT IN ('rejected', 'withdrawn')
      )`,
    )
    conditions.push(
      sql`NOT (
        NOT EXISTS (
          SELECT 1
          FROM ${claims}
          WHERE ${claims.orderId} = ${orders.id}
            AND ${claims.claimStatus} IN ('rejected', 'withdrawn')
        )
        AND (
          (
            COALESCE(${orders.marketplaceStatus}, '') ~ ${CLAIM_LIKE_MARKETPLACE_STATUS_PATTERN}
            AND COALESCE(${orders.marketplaceStatus}, '') !~ ${INACTIVE_MARKETPLACE_CLAIM_STATUS_PATTERN}
          )
          OR (
            COALESCE(${orders.rawData}->>'주문상태', '') ~ ${CLAIM_LIKE_MARKETPLACE_STATUS_PATTERN}
            AND COALESCE(${orders.rawData}->>'주문상태', '') !~ ${INACTIVE_MARKETPLACE_CLAIM_STATUS_PATTERN}
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(${orders.rawData}->'rows', '[]'::jsonb)) AS raw_row(value)
            WHERE COALESCE(raw_row.value #>> '{raw,주문상태}', '') ~ ${CLAIM_LIKE_MARKETPLACE_STATUS_PATTERN}
              AND COALESCE(raw_row.value #>> '{raw,주문상태}', '') !~ ${INACTIVE_MARKETPLACE_CLAIM_STATUS_PATTERN}
          )
        )
      )`,
    )
  }

  return conditions
}

/** Sort column mapping */
function getSortColumn(sort?: string) {
  switch (sort) {
    case 'ordered_at':
      return orders.orderedAt
    case 'created_at':
      return orders.createdAt
    case 'total_amount':
      return orders.totalAmount
    case 'status':
      return orders.status
    case 'marketplace':
      return orders.marketplaceId
    case 'buyer_name':
      return orders.buyerName
    default:
      return orders.orderedAt
  }
}

function getOrderByExpressions(sort?: string, order?: 'asc' | 'desc') {
  const direction = order === 'asc' ? asc : desc

  if (!sort || sort === 'ordered_at') {
    const groupOrderedAt = sql<Date>`COALESCE(
      (
        SELECT MAX(o2.ordered_at)
        FROM orders o2
        WHERE o2.user_id = ${orders.userId}
          AND o2.marketplace_id = ${orders.marketplaceId}
          AND o2.marketplace_order_id IS NOT DISTINCT FROM ${orders.marketplaceOrderId}
      ),
      ${orders.orderedAt}
    )`

    return [
      direction(groupOrderedAt),
      asc(orders.marketplaceId),
      direction(orders.marketplaceOrderId),
      direction(orders.orderedAt),
      desc(orders.createdAt),
      desc(orders.id),
    ]
  }

  const sortColumn = getSortColumn(sort)
  return [
    direction(sortColumn),
    asc(orders.marketplaceId),
    desc(orders.marketplaceOrderId),
    desc(orders.orderedAt),
    desc(orders.createdAt),
    desc(orders.id),
  ]
}

/**
 * Get orders with filtering and pagination.
 * Returns orders with their items for the dashboard table.
 */
export async function getOrders(filters: OrderFilters = {}) {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
  const offset = (page - 1) * pageSize

  const shouldResolveConfirmedProductSearch =
    filters.searchField == null ||
    filters.searchField === 'all' ||
    filters.searchField === 'confirmedProductName'
  const confirmedProductSearchSkus = filters.userId && filters.search && shouldResolveConfirmedProductSearch
    ? await getConfirmedProductSearchSkus(filters.userId, filters.search)
    : undefined

  const conditions = buildOrderWhereClause({
    ...filters,
    confirmedProductSearchSkus,
  })
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const orderByExpressions = getOrderByExpressions(filters.sort, filters.order)
  const needsComputedPagination = !!filters.stage
  const queryLimit = needsComputedPagination ? 10000 : pageSize
  const queryOffset = needsComputedPagination ? 0 : offset
  const includeMappingDetails = filters.includeMappingDetails ?? false
  const includeStock = filters.includeStock ?? false

  // perf: orderRows / count / mapping-lookups 는 서로 의존성이 없으므로
  // 한 wave 에서 병렬 실행한다 (이전엔 4 wave 직렬 → 2 wave 로 압축).
  const userId = filters.userId
  const canUseCachedStatsTotal = !!userId
    && !filters.marketplace
    && !filters.marketplaces?.length
    && !filters.search
    && !filters.dateFrom
    && !filters.dateTo
    && !filters.mapping
    && !filters.orderSource
    && !filters.stage
    && !filters.isHeld
    && !filters.excludeHeld
    && !filters.excludeClaimLikeOrders
    && !filters.scan
    && !filters.scanResult
    && !filters.cancelTab
    && !filters.claimType
    && !filters.statuses?.length

  // userId-scoped mapping 인벤토리 (mappingStatus/displayName 계산용)
  // orderRows + total count — claimType 분기 안에서도 두 쿼리는 같은 IDs 를 공유하므로
  // 같은 IIFE 안에서 처리하되, 외부에서는 userScopedPromise 와 병렬 실행한다.
  const ordersAndCountPromise: Promise<{
    orderRows: (typeof orders.$inferSelect)[]
    total: number
  }> = (async () => {
    const totalPromise = canUseCachedStatsTotal && userId
      ? getOrderStats(userId).then((stats) => {
          if (filters.status) return stats[filters.status] ?? 0
          return stats.total ?? 0
        })
      : db.select({ value: count() }).from(orders).where(whereClause).then((countRows) => countRows[0]?.value ?? 0)

    const [rows, total] = await Promise.all([
      db
        .select()
        .from(orders)
        .where(whereClause)
        .orderBy(...orderByExpressions)
        .limit(queryLimit)
        .offset(queryOffset),
      totalPromise,
    ])
    return { orderRows: rows, total }
  })()

  const { orderRows, total: orderTotal } = await ordersAndCountPromise

  // Fetch items/claims/shipments/shipmentGroups/scan summary in parallel.
  // Phase A 매핑 재설계: productNameMappings LEFT JOIN 제거. 확정상품명은
  // SKU ↔ products.internalSku 직접 매칭(products.name) 으로만 해석.
  const orderIds = orderRows.map((o) => o.id)
  const [itemRows, claimRows, shipmentRows, groupRows, inquiryRows, scanRows] = orderIds.length > 0
    ? await Promise.all([
        db
          .select({
            id: orderItems.id,
            orderId: orderItems.orderId,
            marketplaceItemId: orderItems.marketplaceItemId,
            productName: orderItems.productName,
            optionText: orderItems.optionText,
            quantity: orderItems.quantity,
            unitPrice: orderItems.unitPrice,
            sku: orderItems.sku,
            skuMultiplier: orderItems.skuMultiplier,
            fulfillmentCode: orderItems.fulfillmentCode,
            lockedSku: orderItems.lockedSku,
            lockedProductName: orderItems.lockedProductName,
            lockedOptionName: orderItems.lockedOptionName,
            lockedQuantity: orderItems.lockedQuantity,
            lockedMappingCodeId: orderItems.lockedMappingCodeId,
            lockedMappingCode: orderItems.lockedMappingCode,
            lockedAt: orderItems.lockedAt,
            // 확정상품명 — SKU가 products에 직접 매칭된 경우만 해석
            productInternalName: products.name,
            shippingCost: products.shippingCost,
            orderMarketplaceId: orders.marketplaceId,
            orderUserId: orders.userId,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orders.id, orderItems.orderId))
          .leftJoin(
            products,
            and(
              eq(products.userId, orders.userId),
              eq(products.internalSku, orderItems.sku),
            ),
          )
          .where(inArray(orderItems.orderId, orderIds)),
        db.select().from(claims).where(inArray(claims.orderId, orderIds)),
        db.select().from(shipments).where(inArray(shipments.orderId, orderIds)),
        db
          .select({
            orderId: shipmentGroupOrders.orderId,
            groupId: shipmentGroups.id,
            groupKey: shipmentGroups.groupKey,
          })
          .from(shipmentGroupOrders)
          .innerJoin(shipmentGroups, eq(shipmentGroupOrders.shipmentGroupId, shipmentGroups.id))
          .where(inArray(shipmentGroupOrders.orderId, orderIds)),
        listInquiriesByOrderIds(orderIds),
        db
          .select({
            orderId: scanLogs.orderId,
            status: scanLogs.status,
            trackingNumber: scanLogs.trackingNumber,
            scannedAt: scanLogs.scannedAt,
          })
          .from(scanLogs)
          .where(inArray(scanLogs.orderId, orderIds))
          .orderBy(desc(scanLogs.scannedAt)),
      ])
    : [
        [] as Array<{
          id: string
          orderId: string
          marketplaceItemId: string | null
          productName: string
          optionText: string | null
          quantity: number
          unitPrice: string
          sku: string | null
          skuMultiplier: number
          fulfillmentCode: string | null
          lockedSku: string | null
          lockedProductName: string | null
          lockedOptionName: string | null
          lockedQuantity: number | null
          lockedMappingCodeId: string | null
          lockedMappingCode: string | null
          lockedAt: Date | null
          productInternalName: string | null
          shippingCost: string | null
          orderMarketplaceId: string
          orderUserId: string
        }>,
        [] as (typeof claims.$inferSelect)[],
        [] as (typeof shipments.$inferSelect)[],
        [] as { orderId: string; groupId: string; groupKey: string }[],
        [] as Awaited<ReturnType<typeof listInquiriesByOrderIds>>,
        [] as Array<{
          orderId: string | null
          status: string
          trackingNumber: string
          scannedAt: Date
        }>,
      ]

  const pageSkus = Array.from(new Set(
    itemRows
      .map((item) => item.sku?.trim())
      .filter((sku): sku is string => Boolean(sku)),
  ))
  const pageInventoryRows = userId && pageSkus.length > 0 && (includeMappingDetails || includeStock)
    ? await db
        .select({
          sku: inventory.sku,
          optionName: sql<string | null>`MAX(${inventory.optionName})`,
          availableStock: includeStock
            ? sql<number | null>`COALESCE(SUM(${inventory.availableStock}), 0)::int`
            : sql<number | null>`NULL`,
        })
        .from(inventory)
        .where(and(eq(inventory.userId, userId), inArray(inventory.sku, pageSkus)))
        .groupBy(inventory.sku)
    : []
  const pageInventoryBySku = new Map(pageInventoryRows.map((row) => [row.sku, row]))

  // Phase 8 — base orderItems shape. displayName is enriched below after mapping index is built.
  const mappingCandidates = includeMappingDetails
    ? itemRows.reduce(
        (acc, item) => {
          if (item.sku) {
            acc.skus.add(item.sku)
            acc.marketplaceProductIds.add(item.sku)
          }
          if (item.marketplaceItemId) {
            const marketplaceItemId = item.marketplaceItemId.trim()
            if (marketplaceItemId) {
              acc.marketplaceProductIds.add(marketplaceItemId)
              const sepIdx = marketplaceItemId.indexOf('-')
              if (sepIdx > 0) acc.marketplaceProductIds.add(marketplaceItemId.slice(0, sepIdx))
            }
          }
          return acc
        },
        {
          skus: new Set<string>(),
          marketplaceProductIds: new Set<string>(),
        },
      )
    : {
        skus: new Set<string>(),
        marketplaceProductIds: new Set<string>(),
      }

  const { productSkus, variantSkus, sources: mappingSourceRows, components: mappingComponentRows } =
    userId && includeMappingDetails
      ? await getMappingLookups(userId, {
          skus: Array.from(mappingCandidates.skus),
          marketplaceProductIds: Array.from(mappingCandidates.marketplaceProductIds),
        })
      : {
          productSkus: [] as Array<{ sku: string }>,
          variantSkus: [] as Array<{ sku: string }>,
          sources: [] as Array<{
            mappingCodeId: string
            marketplaceId: string
            marketplaceProductId: string
            marketplaceOptionId: string
          }>,
          components: [] as Array<{
            mappingCodeId: string
            sku: string
            quantity: number
            productName: string | null
            optionName: string | null
            availableStock: number | null
          }>,
        }

  const baseItems = itemRows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    marketplaceItemId: r.marketplaceItemId,
    productName: r.productName,
    optionText: r.optionText,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    sku: r.sku,
    skuMultiplier: r.skuMultiplier,
    fulfillmentCode: r.fulfillmentCode,
    lockedSku: r.lockedSku,
    lockedProductName: r.lockedProductName,
    lockedOptionName: r.lockedOptionName,
    lockedQuantity: r.lockedQuantity,
    lockedMappingCodeId: r.lockedMappingCodeId,
    lockedMappingCode: r.lockedMappingCode,
    lockedAt: r.lockedAt,
    orderMarketplaceId: r.orderMarketplaceId,
    // 직접 SKU 매칭 표시명. 매핑 규칙 표시명은 mappingIndex 생성 후 아래에서 채운다.
    displayName: r.productInternalName ?? null,
    displayOptionName: r.sku ? pageInventoryBySku.get(r.sku)?.optionName ?? null : null,
    shippingCost: r.shippingCost,
    availableStock: r.sku ? pageInventoryBySku.get(r.sku)?.availableStock ?? null : null,
    resolvedMappingCodeId: null as string | null,
  }))

  // Phase 8 — Set of orderIds with at least one inquiry
  const inquirySet = new Set<string>()
  for (const inq of inquiryRows) {
    if (inq.orderId) inquirySet.add(inq.orderId)
  }

  const groupByOrderId = new Map<string, { groupId: string; groupKey: string }>()
  for (const g of groupRows) {
    groupByOrderId.set(g.orderId, { groupId: g.groupId, groupKey: g.groupKey })
  }

  // Map latest shipment per order
  const shipmentByOrderId = new Map<string, typeof shipments.$inferSelect>()
  for (const shipment of shipmentRows) {
    const existing = shipmentByOrderId.get(shipment.orderId)
    if (!existing || shipment.createdAt > existing.createdAt) {
      shipmentByOrderId.set(shipment.orderId, shipment)
    }
  }

  const latestScanByOrderId = new Map<string, typeof scanRows[number]>()
  for (const scan of scanRows) {
    if (!scan.orderId) continue
    if (!latestScanByOrderId.has(scan.orderId)) {
      latestScanByOrderId.set(scan.orderId, scan)
    }
  }

  // Map first claim (most recent by requestedAt) per order — need id/status for inline CS actions
  type ClaimSummary = {
    id: string
    claimType: string
    claimStatus: string
    reason: string | null
    requestReason: string | null
    requestReasonRegisteredAt: Date | string | null
    requestReasonHistory: Array<{ reason: string; registeredAt: Date | string }>
  }
  const claimByOrderId = new Map<string, ClaimSummary>()
  for (const claim of claimRows) {
    if (INACTIVE_CLAIM_STATUSES.includes(claim.claimStatus as (typeof INACTIVE_CLAIM_STATUSES)[number])) {
      continue
    }
    const existing = claimByOrderId.get(claim.orderId)
    if (!existing || claim.requestedAt > (claimRows.find((c) => c.id === existing.id)?.requestedAt ?? new Date(0))) {
      const rawReason = claim.rawData && typeof claim.rawData === 'object'
        ? (claim.rawData as { originalReason?: unknown }).originalReason
        : null
      const requestReason = typeof rawReason === 'string' && rawReason.trim()
        ? rawReason.trim()
        : claim.reason
      const rawRegisteredAt = claim.rawData && typeof claim.rawData === 'object'
        ? (claim.rawData as { reasonRegisteredAt?: unknown }).reasonRegisteredAt
        : null
      const requestReasonRegisteredAt = typeof rawRegisteredAt === 'string' && rawRegisteredAt
        ? rawRegisteredAt
        : claim.requestedAt
      const rawHistory = claim.rawData && typeof claim.rawData === 'object'
        ? (claim.rawData as { reasonHistory?: unknown }).reasonHistory
        : null
      const parsedHistory = Array.isArray(rawHistory)
        ? rawHistory.flatMap((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
            const row = entry as { reason?: unknown; registeredAt?: unknown }
            if (typeof row.reason !== 'string' || !row.reason.trim() || typeof row.registeredAt !== 'string') return []
            return [{ reason: row.reason.trim(), registeredAt: row.registeredAt }]
          })
        : []
      const requestReasonHistory = parsedHistory.length > 0
        ? parsedHistory
        : requestReason
          ? [{ reason: requestReason, registeredAt: requestReasonRegisteredAt }]
          : []
      const latestReason = requestReasonHistory.at(-1)
      claimByOrderId.set(claim.orderId, {
        id: claim.id,
        claimType: claim.claimType,
        claimStatus: claim.claimStatus,
        reason: claim.reason,
        requestReason: latestReason?.reason ?? requestReason,
        requestReasonRegisteredAt: latestReason?.registeredAt ?? requestReasonRegisteredAt,
        requestReasonHistory,
      })
    }
  }

  // perf: productSkus / variantSkus / mappingSources 는 위쪽 userScopedPromise 에서 이미 받아왔다.
  // Phase C — mappingStatus 판정 (사방넷 품번/단품 분리):
  //   1) 단품매핑(`option_id != ''`) 정확일치 → 매핑됨
  //   2) 품번매핑(`option_id = ''`) 정확/prefix 일치 → 매핑됨
  //   3) fallback: orderItems.sku ∈ products.internalSku ∪ productVariants.sku
  const skuSet = new Set<string>()
  for (const p of productSkus) skuSet.add(p.sku)
  for (const v of variantSkus) skuSet.add(v.sku)

  const mappingIndex = buildMappingIndex(
    mappingSourceRows.map<MappingSource>((s) => ({
      marketplaceId: s.marketplaceId,
      marketplaceProductId: s.marketplaceProductId,
      marketplaceOptionId: s.marketplaceOptionId,
      ref: s.mappingCodeId,
    })),
  )

  const componentsByCode = new Map<string, typeof mappingComponentRows>()
  for (const component of mappingComponentRows) {
    const list = componentsByCode.get(component.mappingCodeId) ?? []
    list.push(component)
    componentsByCode.set(component.mappingCodeId, list)
  }

  const componentSignatureByCode = new Map<string, string>()
  for (const [mappingCodeId, components] of componentsByCode) {
    componentSignatureByCode.set(
      mappingCodeId,
      components
        .map((component) => `${component.sku}:${component.quantity}`)
        .sort()
        .join('|'),
    )
  }

  const resolveSameComponentMappingCode = (
    marketplaceId: string,
    candidateIds: string[],
    optionText: string | null,
  ): string | null => {
    const normalizedOptionText = optionText?.trim().slice(0, 100)
    const candidateSet = new Set(candidateIds)
    const matchedSources = mappingSourceRows.filter((source) => {
      if (source.marketplaceId !== marketplaceId) return false
      if (!candidateSet.has(source.marketplaceProductId)) return false
      if (normalizedOptionText) {
        return source.marketplaceOptionId === normalizedOptionText || source.marketplaceOptionId === ''
      }
      return source.marketplaceOptionId === '' || source.marketplaceOptionId === EXACT_OPTION_ID
    })
    const signatures = new Map<string, string>()
    for (const source of matchedSources) {
      const signature = componentSignatureByCode.get(source.mappingCodeId)
      if (!signature) continue
      signatures.set(signature, source.mappingCodeId)
    }
    return signatures.size === 1 ? Array.from(signatures.values())[0] : null
  }

  const getMappedItemInfo = (
    marketplaceId: string,
    marketplaceItemId: string | null,
    rawSku: string | null,
    optionText: string | null,
    orderQuantity: number,
  ): {
    displayName: string
    displayOptionName: string | null
    quantity: number
    sku: string | null
    availableStock: number | null
    mappingCodeId: string
  } | null => {
    const candidateIds = Array.from(new Set(
      [marketplaceItemId, rawSku]
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ))
    const mappingCodeId = candidateIds
      .map((candidateId) => lookupMappingRef(mappingIndex, marketplaceId, candidateId, optionText))
      .find((ref): ref is string => !!ref)
      ?? resolveSameComponentMappingCode(marketplaceId, candidateIds, optionText)
    if (!mappingCodeId) return null
    const components = componentsByCode.get(mappingCodeId) ?? []
    if (components.length === 0) return null
    const displayName = components
      .map((component) => {
        return component.productName ?? component.sku
      })
      .join(' + ')
    const displayOptionName = components
      .map((component) => component.optionName)
      .filter((optionName): optionName is string => !!optionName)
      .join(' + ') || null
    const mappedQuantity = components.reduce(
      (sum, component) => sum + (component.quantity * orderQuantity),
      0,
    )
    return {
      displayName,
      displayOptionName,
      quantity: mappedQuantity > 0 ? mappedQuantity : orderQuantity,
      sku: components.map((component) => component.sku).join(' + '),
      availableStock: components.length === 1 ? components[0].availableStock : null,
      mappingCodeId,
    }
  }

  const items = baseItems.map((item) => {
    const directInternalSku = item.sku && skuSet.has(item.sku.trim()) ? item.sku : null
    if (item.lockedAt) {
      return {
        ...item,
        displayName: item.lockedProductName ?? item.displayName,
        displayOptionName: item.lockedOptionName ?? item.displayOptionName,
        quantity: item.lockedQuantity ?? item.quantity,
        sku: item.lockedSku ?? directInternalSku,
        resolvedMappingCodeId: item.lockedMappingCodeId,
      }
    }
    if (!includeMappingDetails) return { ...item, sku: directInternalSku }
    const mapped = getMappedItemInfo(
      item.orderMarketplaceId,
      item.marketplaceItemId,
      item.sku,
      item.optionText,
      item.quantity,
    )
    if (!mapped) return { ...item, sku: directInternalSku }
    return {
      ...item,
      displayName: mapped.displayName,
      displayOptionName: mapped.displayOptionName,
      quantity: mapped.quantity,
      sku: mapped.sku ?? item.sku,
      availableStock: mapped.availableStock ?? item.availableStock,
      resolvedMappingCodeId: mapped.mappingCodeId,
    }
  })

  // Group items by orderId — Phase 8 shape (orderItems base + displayName + shippingCost)
  type ItemRow = typeof items[number]
  const itemsByOrderId = new Map<string, ItemRow[]>()
  for (const item of items) {
    const existing = itemsByOrderId.get(item.orderId) ?? []
    existing.push(item)
    itemsByOrderId.set(item.orderId, existing)
  }

  const getComputedMappingStatus = (order: typeof orders.$inferSelect, orderItemsData: ItemRow[]): MappingStatus => {
    if (!order.mappedAt || orderItemsData.length === 0) return 'unmapped'

    const resolvedCount = orderItemsData.filter((item) => {
      const sku = item.sku?.trim()
      return Boolean(sku || item.resolvedMappingCodeId)
    }).length

    if (resolvedCount === orderItemsData.length) return 'mapped'
    if (resolvedCount > 0) return 'partial'
    return 'unmapped'
  }

  // Combine orders with items, claim, shipment info, and mapping status
  let ordersWithItems = orderRows.map((order) => {
    const shipment = shipmentByOrderId.get(order.id)
    const orderItemsData = itemsByOrderId.get(order.id) ?? []
    const claim = claimByOrderId.get(order.id) ?? null
    const group = groupByOrderId.get(order.id) ?? null
    const latestScan = latestScanByOrderId.get(order.id) ?? null
    return {
      ...order,
      marketplaceOrderId: getOrderMarketplaceOrderDisplayId(order),
      claimType: claim?.claimType ?? null,
      claimId: claim?.id ?? null,
      claimStatus: claim?.claimStatus ?? null,
      claimReason: claim?.reason ?? null,
      claimRequestReason: claim?.requestReason ?? null,
      claimRequestReasonRegisteredAt: claim?.requestReasonRegisteredAt ?? null,
      claimRequestReasonHistory: claim?.requestReasonHistory ?? [],
      invoiceStatus: shipment?.uploadStatus ?? null,
      trackingNumber: shipment?.trackingNumber ?? null,
      carrierName: shipment?.carrierName ?? null,
      shipmentGroupId: group?.groupId ?? null,
      shipmentGroupKey: group?.groupKey ?? null,
      scanStatus: latestScan?.status ?? null,
      scannedAt: latestScan?.scannedAt ?? null,
      scanTrackingNumber: latestScan?.trackingNumber ?? null,
      // Phase 8 — inquiry indicator source for orders UI (SC-03)
      hasInquiries: inquirySet.has(order.id),
      items: orderItemsData,
      mappingStatus: getComputedMappingStatus(order, orderItemsData),
      marketplaceDisplayName: getOrderMarketplaceDisplayName(order),
      historicalClaimStatuses: getOrderHistoricalClaimStatuses(order),
    }
  })

  // Apply workflow stage filter (post-fetch, computed)
  if (filters.stage) {
    ordersWithItems = ordersWithItems.filter((o) => matchStage(o, filters.stage!))
  }

  // 확정대기 단계: 같은 합포장 그룹 주문이 인접하도록 정렬 (그룹 있는 것 먼저)
  if (filters.stage === 'confirm') {
    ordersWithItems.sort((a, b) => {
      const aG = a.shipmentGroupId
      const bG = b.shipmentGroupId
      if (aG && !bG) return -1
      if (!aG && bG) return 1
      if (aG && bG && aG !== bG) return aG < bG ? -1 : 1
      return 0
    })
  }

  const computedTotal = ordersWithItems.length
  const pagedOrders = needsComputedPagination
    ? ordersWithItems.slice(offset, offset + pageSize)
    : ordersWithItems

  // perf: 일반 목록 total count 는 ordersAndCountPromise 에서 같이 가져온다.
  // mapping/stage 는 품목/매핑 계산 뒤에 필터링해야 하므로 계산 후 total/page slice 를 적용한다.
  return {
    orders: pagedOrders,
    total: needsComputedPagination ? computedTotal : orderTotal,
  }
}

/**
 * Get single order by ID with items and claims.
 */
export async function getOrderById(id: string, userId?: string) {
  const whereClause = userId
    ? and(eq(orders.id, id), eq(orders.userId, userId))
    : eq(orders.id, id)

  const [order] = await db.select().from(orders).where(whereClause)

  if (!order) return null

  const [orderItemRows, claimRows, memoRows, shipmentRows, scanLogRows, changeLogRows] = await Promise.all([
    // 수집상품명(productName) + 확정상품명 동시 반환
    // Phase A 매핑 재설계: 확정상품명은 SKU ↔ products.internalSku 직접 매칭(products.name) 만 사용.
    db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        marketplaceItemId: orderItems.marketplaceItemId,
        productName: orderItems.productName,
        optionText: orderItems.optionText,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        sku: orderItems.sku,
        skuMultiplier: orderItems.skuMultiplier,
        fulfillmentCode: orderItems.fulfillmentCode,
        lockedSku: orderItems.lockedSku,
        lockedProductName: orderItems.lockedProductName,
        lockedOptionName: orderItems.lockedOptionName,
        lockedQuantity: orderItems.lockedQuantity,
        lockedAt: orderItems.lockedAt,
        productInternalName: products.name,
        productInternalOptionName: sql<string | null>`(
          SELECT MAX(${inventory.optionName})
          FROM ${inventory}
          WHERE ${inventory.userId} = ${orders.userId}
            AND ${inventory.sku} = ${orderItems.sku}
        )`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .leftJoin(
        products,
        and(
          eq(products.userId, orders.userId),
          eq(products.internalSku, orderItems.sku),
        ),
      )
      .where(eq(orderItems.orderId, id)),
    db.select().from(claims).where(eq(claims.orderId, id)),
    db
      .select()
      .from(orderMemos)
      .where(eq(orderMemos.orderId, id))
      .orderBy(desc(orderMemos.createdAt)),
    db.select().from(shipments).where(eq(shipments.orderId, id)),
    // 바코드 스캔 이력 — 최신순. 상세 페이지의 '바코드 스캔 여부' 섹션 표시용.
    db
      .select()
      .from(scanLogs)
      .where(eq(scanLogs.orderId, id))
      .orderBy(desc(scanLogs.scannedAt)),
    getOrderChangeLogs(id),
  ])

  const latestShipment =
    shipmentRows.length > 0
      ? shipmentRows.reduce((prev, cur) =>
          cur.createdAt > prev.createdAt ? cur : prev,
        )
      : null

  const detailMappingCandidates = orderItemRows.reduce(
    (acc, item) => {
      if (item.sku) {
        acc.skus.add(item.sku)
        acc.marketplaceProductIds.add(item.sku)
      }
      if (item.marketplaceItemId) {
        const marketplaceItemId = item.marketplaceItemId.trim()
        if (marketplaceItemId) {
          acc.marketplaceProductIds.add(marketplaceItemId)
          const sepIdx = marketplaceItemId.indexOf('-')
          if (sepIdx > 0) acc.marketplaceProductIds.add(marketplaceItemId.slice(0, sepIdx))
        }
      }
      return acc
    },
    {
      skus: new Set<string>(),
      marketplaceProductIds: new Set<string>(),
    },
  )
  const detailLookups = await getMappingLookups(order.userId, {
    skus: Array.from(detailMappingCandidates.skus),
    marketplaceProductIds: Array.from(detailMappingCandidates.marketplaceProductIds),
  })
  const detailMappingIndex = buildMappingIndex(
    detailLookups.sources.map<MappingSource>((source) => ({
      marketplaceId: source.marketplaceId,
      marketplaceProductId: source.marketplaceProductId,
      marketplaceOptionId: source.marketplaceOptionId,
      ref: source.mappingCodeId,
    })),
  )
  const detailComponentsByCode = new Map<string, typeof detailLookups.components>()
  for (const component of detailLookups.components) {
    const list = detailComponentsByCode.get(component.mappingCodeId) ?? []
    list.push(component)
    detailComponentsByCode.set(component.mappingCodeId, list)
  }
  const detailSkuSet = new Set<string>()
  for (const productSku of detailLookups.productSkus) detailSkuSet.add(productSku.sku)
  for (const variantSku of detailLookups.variantSkus) detailSkuSet.add(variantSku.sku)

  // 확정상품명 fallback chain
  const items = orderItemRows.map((r) => {
    const locked = !!r.lockedAt
    const candidateIds = Array.from(new Set(
      [r.marketplaceItemId, r.sku]
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ))
    const mappingCodeId = !locked
      ? candidateIds
          .map((candidateId) => lookupMappingRef(detailMappingIndex, order.marketplaceId, candidateId, r.optionText))
          .find((ref): ref is string => !!ref) ?? null
      : null
    const components = mappingCodeId ? detailComponentsByCode.get(mappingCodeId) ?? [] : []
    const mappedDisplayName = components.length > 0
      ? components.map((component) => component.productName ?? component.sku).join(' + ')
      : null
    const mappedOptionName = components.length > 0
      ? components
          .map((component) => component.optionName)
          .filter((optionName): optionName is string => !!optionName)
          .join(' + ') || null
      : null
    const mappedSku = components.length > 0
      ? components.map((component) => component.sku).join(' + ')
      : null
    const mappedQuantity = components.length > 0
      ? components.reduce((sum, component) => sum + component.quantity * r.quantity * (r.skuMultiplier ?? 1), 0)
      : null
    const directInternalSku = r.sku && detailSkuSet.has(r.sku.trim()) ? r.sku : null
    return {
      id: r.id,
      orderId: r.orderId,
      marketplaceItemId: r.marketplaceItemId,
      productName: r.productName,
      optionText: r.optionText,
      quantity: locked ? r.lockedQuantity ?? r.quantity : mappedQuantity ?? r.quantity,
      unitPrice: r.unitPrice,
      sku: locked ? r.lockedSku ?? directInternalSku : mappedSku ?? directInternalSku,
      skuMultiplier: r.skuMultiplier,
      fulfillmentCode: r.fulfillmentCode,
      displayName: locked ? r.lockedProductName ?? r.productInternalName ?? null : mappedDisplayName ?? r.productInternalName ?? null,
      displayOptionName: locked ? r.lockedOptionName ?? r.productInternalOptionName ?? null : mappedOptionName ?? r.productInternalOptionName ?? null,
      lockedAt: r.lockedAt,
    }
  })

  return {
    ...order,
    items,
    claims: claimRows,
    memos: memoRows,
    shipment: latestShipment,
    /** 모든 송장 — 송장정보 섹션에서 다중 송장(분할배송)도 표시할 수 있도록 */
    shipments: shipmentRows,
    /** 바코드 스캔 이력 — 최신순 */
    scanLogs: scanLogRows,
    /** 주문 변경 이력 — 최신순 */
    changeLogs: changeLogRows,
  }
}

/**
 * 주문 출고 시 실제 차감될 재고 미리보기.
 *
 * Phase C 매핑코드 시스템:
 *   1) (marketplaceId, marketplaceItemId) 가 mapping_sources 에 있으면
 *      mapping_components 의 SKU + 수량으로 전개 (단품=1, 세트=N).
 *   2) 매칭 없으면 fallback: orderItems.sku 직접 사용.
 *   3) 같은 SKU 가 여러 줄에서 나오면 합산.
 */
export interface StockDeductionPreviewRow {
  sku: string
  productName: string | null
  requiredQty: number
  totalStock: number | null
  availableStock: number | null
  sufficient: boolean
  isBundleComponent: boolean
  sourceItems: Array<{ productName: string; optionText: string | null; orderQty: number }>
}

export async function getStockDeductionPreview(
  orderId: string,
  userId: string,
): Promise<StockDeductionPreviewRow[]> {
  const rows = await db
    .select({
      sku: orderItems.sku,
      productName: orderItems.productName,
      optionText: orderItems.optionText,
      quantity: orderItems.quantity,
      skuMultiplier: orderItems.skuMultiplier,
      marketplaceItemId: orderItems.marketplaceItemId,
      orderMarketplaceId: orders.marketplaceId,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orderItems.orderId, orderId),
        eq(orders.userId, userId),
      ),
    )

  if (rows.length === 0) return []

  // 사방넷 품번/단품 매핑 — sources + components 한 번에 join.
  const mappingRows = await db
    .select({
      mappingCodeId: mappingSources.mappingCodeId,
      marketplaceId: mappingSources.marketplaceId,
      marketplaceProductId: mappingSources.marketplaceProductId,
      marketplaceOptionId: mappingSources.marketplaceOptionId,
      componentSku: mappingComponents.sku,
      componentQuantity: mappingComponents.quantity,
    })
    .from(mappingSources)
    .innerJoin(mappingComponents, eq(mappingComponents.mappingCodeId, mappingSources.mappingCodeId))
    .where(eq(mappingSources.userId, userId))

  // mappingCodeId 별로 components 모아두기
  const componentsByCode = new Map<string, Array<{ sku: string; quantity: number }>>()
  for (const m of mappingRows) {
    const list = componentsByCode.get(m.mappingCodeId) ?? []
    if (!list.some((c) => c.sku === m.componentSku && c.quantity === m.componentQuantity)) {
      list.push({ sku: m.componentSku, quantity: m.componentQuantity })
    }
    componentsByCode.set(m.mappingCodeId, list)
  }

  // sources index 구성 (ref = mappingCodeId)
  const sourcesForIndex: MappingSource[] = []
  const seenSrc = new Set<string>()
  for (const m of mappingRows) {
    const key = `${m.marketplaceId}:${m.marketplaceProductId}:${m.marketplaceOptionId}`
    if (seenSrc.has(key)) continue
    seenSrc.add(key)
    sourcesForIndex.push({
      marketplaceId: m.marketplaceId,
      marketplaceProductId: m.marketplaceProductId,
      marketplaceOptionId: m.marketplaceOptionId,
      ref: m.mappingCodeId,
    })
  }
  const mappingIndex = buildMappingIndex(sourcesForIndex)

  // Accumulator: sku → { requiredQty, sourceItems, isBundleComponent }
  const acc = new Map<
    string,
    {
      requiredQty: number
      sourceItems: Array<{ productName: string; optionText: string | null; orderQty: number }>
      isBundleComponent: boolean
    }
  >()
  const addToAcc = (
    sku: string,
    qty: number,
    src: { productName: string; optionText: string | null; orderQty: number },
    isBundle: boolean,
  ) => {
    const cur = acc.get(sku) ?? { requiredQty: 0, sourceItems: [], isBundleComponent: false }
    cur.requiredQty += qty
    cur.sourceItems.push(src)
    cur.isBundleComponent = cur.isBundleComponent || isBundle
    acc.set(sku, cur)
  }

  for (const row of rows) {
    const orderQty = row.quantity * (row.skuMultiplier ?? 1)
    const mappingCodeId = row.marketplaceItemId
      ? lookupMappingRef(mappingIndex, row.orderMarketplaceId, row.marketplaceItemId, row.optionText)
      : null
    const components = mappingCodeId ? componentsByCode.get(mappingCodeId) : null
    const src = {
      productName: row.productName ?? '',
      optionText: row.optionText,
      orderQty,
    }

    if (components && components.length > 0) {
      const isBundle = components.length > 1
      for (const c of components) {
        addToAcc(c.sku, orderQty * c.quantity, src, isBundle)
      }
    } else if (row.sku) {
      addToAcc(row.sku, orderQty, src, false)
    }
    // else: 매핑도 없고 sku 도 없음 → preview 에서 제외
  }

  const skus = Array.from(acc.keys())
  if (skus.length === 0) return []

  const invRows = await db
    .select({
      sku: inventory.sku,
      productName: sql<string | null>`MAX(${inventory.productName})`,
      totalStock: sql<number>`COALESCE(SUM(${inventory.totalStock}), 0)::int`,
      availableStock: sql<number>`COALESCE(SUM(${inventory.availableStock}), 0)::int`,
    })
    .from(inventory)
    .where(and(eq(inventory.userId, userId), inArray(inventory.sku, skus)))
    .groupBy(inventory.sku)

  const invMap = new Map(invRows.map((r) => [r.sku, r]))

  return skus.map((sku) => {
    const { requiredQty, sourceItems, isBundleComponent } = acc.get(sku)!
    const inv = invMap.get(sku)
    return {
      sku,
      productName: inv?.productName ?? null,
      requiredQty,
      totalStock: inv?.totalStock ?? null,
      availableStock: inv?.availableStock ?? null,
      sufficient: inv ? (inv.availableStock ?? 0) >= requiredQty : false,
      isBundleComponent,
      sourceItems,
    }
  })
}

/**
 * Phase 8 — Dashboard 9탭 summary counts.
 * Three focused queries (per-status group, per-claimType distinct group,
 * cancelTab distinct OR) so each tab badge is exact at SQL level.
 *
 * - Status counts: `groupBy(orders.status)` (single GROUP BY scan)
 * - Claim counts: `countDistinct(claims.orderId)` per claimType
 * - cancelTabCount: `countDistinct(orders.id)` WHERE status='cancelled' OR has cancel claim
 *
 * All scoped by userId (RLS pattern + perf).
 */
/**
 * Cached entry-point. 호출자는 `getOrderStats(userId)` 그대로 쓰면 30초 캐시 히트.
 */
export function getOrderStats(userId: string): Promise<OrderStats> {
  return getOrderStatsCached(userId)
}

async function getOrderStatsImpl(userId: string): Promise<OrderStats> {
  const [statusRows, claimRows, cancelTabRows, totalRow, heldRow] = await Promise.all([
    db
      .select({ status: orders.status, value: count() })
      .from(orders)
      .where(eq(orders.userId, userId))
      .groupBy(orders.status),
    db
      .select({ claimType: claims.claimType, value: countDistinct(claims.orderId) })
      .from(claims)
      .innerJoin(orders, eq(orders.id, claims.orderId))
      .where(and(eq(orders.userId, userId), notInArray(claims.claimStatus, [...INACTIVE_CLAIM_STATUSES])))
      .groupBy(claims.claimType),
    db
      .select({ value: countDistinct(orders.id) })
      .from(orders)
      .leftJoin(
        claims,
        and(
          eq(claims.orderId, orders.id),
          eq(claims.claimType, 'cancel'),
          notInArray(claims.claimStatus, [...INACTIVE_CLAIM_STATUSES]),
        ),
      )
      .where(
        and(
          eq(orders.userId, userId),
          or(eq(orders.status, 'cancelled'), isNotNull(claims.id)),
        ),
      ),
    db.select({ value: count() }).from(orders).where(eq(orders.userId, userId)),
    db
      .select({ value: count() })
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.isHeld, true))),
  ])

  const byStatus: Record<string, number> = {}
  for (const row of statusRows) byStatus[row.status] = row.value

  const byClaim: Record<string, number> = {}
  for (const row of claimRows) byClaim[row.claimType] = row.value

  const cancelTabCount = cancelTabRows[0]?.value ?? 0

  return {
    new: byStatus.new ?? 0,
    confirmed: byStatus.confirmed ?? 0,
    preparing: byStatus.preparing ?? 0,
    ready: byStatus.ready ?? 0,
    shipped: byStatus.shipped ?? 0,
    delivering: byStatus.delivering ?? 0,
    delivered: byStatus.delivered ?? 0,
    cancelled: byStatus.cancelled ?? 0,
    claimCancel: byClaim.cancel ?? 0,
    claimExchange: byClaim.exchange ?? 0,
    claimReturn: byClaim.return ?? 0,
    cancelTabCount,
    // legacy/aux fields — kept for backward compatibility with older callers
    total: totalRow[0]?.value ?? 0,
    held: heldRow[0]?.value ?? 0,
    cancel: byClaim.cancel ?? 0,
    return: byClaim.return ?? 0,
    exchange: byClaim.exchange ?? 0,
    newCount: byStatus.new ?? 0,
  }
}

/**
 * Get order count for pagination without fetching all data.
 */
export async function getOrderCount(
  filters: Omit<OrderFilters, 'page' | 'pageSize'> = {},
) {
  const conditions = buildOrderWhereClause(filters)
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const [result] = await db
    .select({ value: count() })
    .from(orders)
    .where(whereClause)

  return result?.value ?? 0
}
