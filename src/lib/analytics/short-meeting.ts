import { and, eq, inArray, sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { purchaseRequestItems } from '@/lib/db/schema'
import { getSkuOutgoingMetrics } from '@/lib/purchasing/items'
import { getSaasChinaInventory } from '@/lib/purchasing/saas-china-outbound'
import { PURCHASE_REQUEST_STATUS_LABELS, type PurchaseRequestStatus } from '@/lib/purchasing/purchase-request-status'
import { getShortMeetingStockList } from './short-meeting-stock-list'

export interface ShortMeetingRow {
  sku: string
  productName: string
  optionName: string
  todayOutbound: number
  currentStock: number
  stockAfterOutbound: number
  averageDailyOutbound: number
  monthOutbound: number
  stockStatus: 'out' | 'risk' | 'normal'
  outOfStock: string | null
  chinaStock: number | null
  chinaShipmentDate: string | null
  chinaOrderDate: string | null
  chinaOrderStatus: string | null
  location: string
}

export interface ShortMeetingData {
  rows: ShortMeetingRow[]
  sheetStatus: 'available' | 'unavailable'
  summary: {
    productCount: number
    todayOutbound: number
    outOfStockCount: number
    riskCount: number
  }
  dateLabel: string
}

type ShortMeetingQueryRow = {
  sku: string
  productName: string | null
  optionName: string | null
  todayOutbound: string | number | null
  currentStock: string | number | null
  location: string | null
}

const STATUS_FILTER = sql`('new', 'confirmed', 'preparing', 'ready', 'shipped', 'delivering', 'delivered')`

export async function getShortMeetingData(userId: string): Promise<ShortMeetingData> {
  const stockListPromise = getShortMeetingStockList().catch((error) => {
    console.error('short meeting stock list error:', error)
    return null
  })
  const result = await db.execute<ShortMeetingQueryRow>(sql`
    WITH today_items AS (
      SELECT
        COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) AS sku,
        MAX(COALESCE(NULLIF(oi.locked_product_name, ''), NULLIF(p.name, ''), oi.product_name)) AS product_name,
        MAX(COALESCE(NULLIF(oi.locked_option_name, ''), NULLIF(i.option_name, ''), NULLIF(oi.option_text, ''), '단품')) AS option_name,
        SUM(COALESCE(oi.locked_quantity, oi.quantity * COALESCE(oi.sku_multiplier, 1))) AS today_outbound
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p
        ON p.user_id = o.user_id
       AND p.internal_sku = COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
      LEFT JOIN LATERAL (
        SELECT MAX(inv.option_name) AS option_name
        FROM inventory inv
        WHERE inv.user_id = o.user_id
          AND inv.sku = COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
      ) i ON true
      WHERE o.user_id = ${userId}
        AND (COALESCE(o.ordered_at, o.collected_at) AT TIME ZONE 'Asia/Seoul')::date
          = (NOW() AT TIME ZONE 'Asia/Seoul')::date
        AND o.status::text IN ${STATUS_FILTER}
        AND COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) IS NOT NULL
      GROUP BY COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
    ),
    inventory_summary AS (
      SELECT
        sku,
        SUM(available_stock) AS current_stock,
        STRING_AGG(
          DISTINCT COALESCE(NULLIF(sector_code, ''), NULLIF(warehouse_zone, '')),
          ', '
        ) FILTER (WHERE COALESCE(NULLIF(sector_code, ''), NULLIF(warehouse_zone, '')) IS NOT NULL) AS location
      FROM inventory
      WHERE user_id = ${userId}
        AND warehouse_zone IN ('1창고', '쿠팡', '쿠팡창고')
      GROUP BY sku
    )
    SELECT
      ti.sku,
      ti.product_name AS "productName",
      ti.option_name AS "optionName",
      ti.today_outbound::text AS "todayOutbound",
      COALESCE(inv.current_stock, 0)::text AS "currentStock",
      COALESCE(inv.location, p.warehouse_location, '-') AS location
    FROM today_items ti
    LEFT JOIN inventory_summary inv ON inv.sku = ti.sku
    LEFT JOIN products p ON p.user_id = ${userId} AND p.internal_sku = ti.sku
    ORDER BY
      CASE
        WHEN COALESCE(inv.current_stock, 0) - ti.today_outbound <= 0 THEN 0
        ELSE 2
      END,
      ti.today_outbound DESC,
      ti.product_name
  `)

  const queryRows = resultRows(result)
  const skus = queryRows.map((row) => row.sku)
  if (skus.length === 0) {
    const stockList = await stockListPromise
    return { ...emptyShortMeetingData(), sheetStatus: stockList ? 'available' : 'unavailable' }
  }

  const [outgoingBySku, chinaInventory, purchases, stockList] = await Promise.all([
    getSkuOutgoingMetrics(userId, skus),
    getSaasChinaInventory(userId),
    db.select({
      sku: purchaseRequestItems.sku,
      status: purchaseRequestItems.status,
      requestDate: purchaseRequestItems.requestDate,
      outboundExpectedDate: purchaseRequestItems.outboundExpectedDate,
      rawData: purchaseRequestItems.rawData,
    }).from(purchaseRequestItems).where(and(
      eq(purchaseRequestItems.userId, userId),
      inArray(purchaseRequestItems.sku, skus),
      inArray(purchaseRequestItems.status, ['purchased', 'purchase_completed', 'inspecting', 'china_arrived', 'completed']),
    )),
    stockListPromise,
  ])
  const chinaStockBySku = new Map<string, number>()
  for (const item of chinaInventory.items) {
    chinaStockBySku.set(item.sku, (chinaStockBySku.get(item.sku) ?? 0) + item.availableQuantity)
  }
  const purchaseBySku = summarizeMeetingPurchases(purchases, seoulToday())
  const rows = queryRows.map((row) => {
    const outgoing = outgoingBySku.get(row.sku)
    return { ...toShortMeetingRow(row, {
      monthlyAverage: outgoing?.threeMonthAverageOutgoing ?? 0,
      monthOutbound: outgoing?.currentMonthOutgoing ?? 0,
      chinaStock: chinaStockBySku.get(row.sku) ?? 0,
      purchase: purchaseBySku.get(row.sku),
    }), outOfStock: stockList?.get(row.sku) ?? null }
  }).sort((a, b) => {
    const priority = { out: 0, risk: 1, normal: 2 }
    return priority[a.stockStatus] - priority[b.stockStatus] || b.todayOutbound - a.todayOutbound || a.productName.localeCompare(b.productName, 'ko')
  })
  return {
    rows,
    sheetStatus: stockList ? 'available' : 'unavailable',
    summary: {
      productCount: rows.length,
      todayOutbound: rows.reduce((sum, row) => sum + row.todayOutbound, 0),
      outOfStockCount: rows.filter((row) => row.stockStatus === 'out').length,
      riskCount: rows.filter((row) => row.stockStatus === 'risk').length,
    },
    dateLabel: new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date()),
  }
}

export const getCachedShortMeetingData = unstable_cache(
  async (userId: string) => getShortMeetingData(userId),
  ['short-meeting'],
  { revalidate: 30 },
)

export function emptyShortMeetingData(): ShortMeetingData {
  return {
    rows: [],
    sheetStatus: 'unavailable',
    summary: { productCount: 0, todayOutbound: 0, outOfStockCount: 0, riskCount: 0 },
    dateLabel: new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date()),
  }
}

type MeetingPurchase = {
  sku: string
  status: PurchaseRequestStatus
  requestDate: string | null
  outboundExpectedDate: string | null
  rawData: Record<string, unknown>
}

type MeetingPurchaseSummary = {
  chinaShipmentDate: string | null
  chinaOrderDate: string | null
  chinaOrderStatus: string | null
}

/** An unknown purchase date is retained: it is not demonstrably older than one month. */
export function summarizeMeetingPurchases(rows: MeetingPurchase[], today: string): Map<string, MeetingPurchaseSummary> {
  const groups = new Map<string, { shipmentDates: Set<string>; orderDates: Set<string>; statuses: Set<string> }>()
  const cutoff = previousCalendarMonth(today)
  for (const row of rows) {
    const rawPurchaseDate = row.rawData?.purchaseDate
    const recordedPurchaseDate = typeof rawPurchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawPurchaseDate)
      ? rawPurchaseDate : null
    const purchaseDate = recordedPurchaseDate ?? (
      row.rawData?.source === 'ecount_purchasing_snapshot_china_arrived' ? row.requestDate
        : row.status === 'purchase_completed' || row.status === 'inspecting' || row.status === 'china_arrived'
          ? row.outboundExpectedDate : null
    )
    if (row.status !== 'completed' && purchaseDate && purchaseDate <= cutoff) continue
    const group = groups.get(row.sku) ?? { shipmentDates: new Set<string>(), orderDates: new Set<string>(), statuses: new Set<string>() }
    if (row.status === 'completed') {
      if (row.outboundExpectedDate) group.shipmentDates.add(row.outboundExpectedDate)
    } else {
      group.statuses.add(PURCHASE_REQUEST_STATUS_LABELS[row.status])
      const date = purchaseDate ?? (row.status === 'purchased' ? row.requestDate : null)
      if (date) group.orderDates.add(date)
    }
    groups.set(row.sku, group)
  }
  return new Map(Array.from(groups, ([sku, group]) => [sku, {
    chinaShipmentDate: Array.from(group.shipmentDates).sort().reverse().join(', ') || null,
    chinaOrderDate: Array.from(group.orderDates).sort().reverse().join(', ') || null,
    chinaOrderStatus: Array.from(group.statuses).join(', ') || null,
  }]))
}

function seoulToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function previousCalendarMonth(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month - 1, 0)).getUTCDate()
  const previous = new Date(Date.UTC(year, month - 2, Math.min(day, lastDay)))
  return previous.toISOString().slice(0, 10)
}

function toShortMeetingRow(row: ShortMeetingQueryRow, data: {
  monthlyAverage: number
  monthOutbound: number
  chinaStock: number
  purchase?: MeetingPurchaseSummary
}): ShortMeetingRow {
  const todayOutbound = toNumber(row.todayOutbound)
  const currentStock = toNumber(row.currentStock)
  // Historical field name retained for callers; this value is a monthly average.
  const averageDailyOutbound = data.monthlyAverage
  const stockAfterOutbound = currentStock - todayOutbound
  const stockStatus = stockAfterOutbound <= 0
    ? 'out'
    : averageDailyOutbound > 0 && stockAfterOutbound <= (averageDailyOutbound / 30) * 7
      ? 'risk'
      : 'normal'

  return {
    sku: row.sku,
    productName: row.productName || '상품명 없음',
    optionName: row.optionName || '단품',
    todayOutbound,
    currentStock,
    stockAfterOutbound,
    averageDailyOutbound,
    monthOutbound: data.monthOutbound,
    stockStatus,
    outOfStock: null,
    chinaStock: data.chinaStock,
    chinaShipmentDate: data.purchase?.chinaShipmentDate ?? null,
    chinaOrderDate: data.purchase?.chinaOrderDate ?? null,
    chinaOrderStatus: data.purchase?.chinaOrderStatus ?? null,
    location: row.location || '-',
  }
}

function resultRows<T>(result: T[] | { rows?: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows ?? []
}

function toNumber(value: string | number | null | undefined): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}
