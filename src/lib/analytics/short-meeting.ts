import { sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'

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
  chinaStock: number | null
  chinaShipmentDate: string | null
  chinaOrderDate: string | null
  location: string
}

export interface ShortMeetingData {
  rows: ShortMeetingRow[]
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
  averageDailyOutbound: string | number | null
  monthOutbound: string | number | null
  location: string | null
}

const STATUS_FILTER = sql`('new', 'confirmed', 'preparing', 'ready', 'shipped', 'delivering', 'delivered')`

export async function getShortMeetingData(userId: string): Promise<ShortMeetingData> {
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
        AND (COALESCE(o.collected_at, o.ordered_at) AT TIME ZONE 'Asia/Seoul')::date
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
      GROUP BY sku
    ),
    shipped_orders AS (
      SELECT
        o.id,
        MIN(s.shipped_at) AS shipped_at
      FROM orders o
      JOIN shipments s ON s.order_id = o.id
      WHERE o.user_id = ${userId}
        AND s.shipped_at >= LEAST(
          date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul',
          ((NOW() AT TIME ZONE 'Asia/Seoul') - interval '30 days') AT TIME ZONE 'Asia/Seoul'
        )
        AND s.shipped_at < (date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') + interval '1 day') AT TIME ZONE 'Asia/Seoul'
      GROUP BY o.id
    ),
    outbound_summary AS (
      SELECT
        COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) AS sku,
        SUM(
          COALESCE(oi.locked_quantity, oi.quantity * COALESCE(oi.sku_multiplier, 1))
        ) FILTER (
          WHERE so.shipped_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
        ) AS month_outbound,
        SUM(
          COALESCE(oi.locked_quantity, oi.quantity * COALESCE(oi.sku_multiplier, 1))
        ) FILTER (
          WHERE so.shipped_at >= ((NOW() AT TIME ZONE 'Asia/Seoul') - interval '30 days') AT TIME ZONE 'Asia/Seoul'
        ) / 30.0 AS average_daily_outbound
      FROM shipped_orders so
      JOIN order_items oi ON oi.order_id = so.id
      WHERE COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) IS NOT NULL
      GROUP BY COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
    )
    SELECT
      ti.sku,
      ti.product_name AS "productName",
      ti.option_name AS "optionName",
      ti.today_outbound::text AS "todayOutbound",
      COALESCE(inv.current_stock, 0)::text AS "currentStock",
      COALESCE(os.average_daily_outbound, 0)::text AS "averageDailyOutbound",
      COALESCE(os.month_outbound, 0)::text AS "monthOutbound",
      COALESCE(inv.location, p.warehouse_location, '-') AS location
    FROM today_items ti
    LEFT JOIN inventory_summary inv ON inv.sku = ti.sku
    LEFT JOIN outbound_summary os ON os.sku = ti.sku
    LEFT JOIN products p ON p.user_id = ${userId} AND p.internal_sku = ti.sku
    ORDER BY
      CASE
        WHEN COALESCE(inv.current_stock, 0) - ti.today_outbound <= 0 THEN 0
        WHEN COALESCE(inv.current_stock, 0) - ti.today_outbound <= COALESCE(os.average_daily_outbound, 0) * 7 THEN 1
        ELSE 2
      END,
      ti.today_outbound DESC,
      ti.product_name
  `)

  const rows = resultRows(result).map(toShortMeetingRow)
  return {
    rows,
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
    summary: { productCount: 0, todayOutbound: 0, outOfStockCount: 0, riskCount: 0 },
    dateLabel: new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date()),
  }
}

function toShortMeetingRow(row: ShortMeetingQueryRow): ShortMeetingRow {
  const todayOutbound = toNumber(row.todayOutbound)
  const currentStock = toNumber(row.currentStock)
  const averageDailyOutbound = toNumber(row.averageDailyOutbound)
  const stockAfterOutbound = currentStock - todayOutbound
  const stockStatus = stockAfterOutbound <= 0
    ? 'out'
    : averageDailyOutbound > 0 && stockAfterOutbound <= averageDailyOutbound * 7
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
    monthOutbound: toNumber(row.monthOutbound),
    stockStatus,
    chinaStock: null,
    chinaShipmentDate: null,
    chinaOrderDate: null,
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
