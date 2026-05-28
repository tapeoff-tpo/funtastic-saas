import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { ensureActualShippingCostsTable } from '@/lib/shipping/actual-costs'

export interface SalesSummaryCard {
  key: string
  label: string
  value: number
  suffix?: string
  subLabel: string
}

export interface MarketplaceSalesRow {
  marketplaceId: string
  marketplaceName: string
  sales: number
  marketplaceFee: number
  productCost: number
  paidShippingFee: number
  actualShippingFee: number
  shippingMargin: number
  boxCost: number
  finalProfit: number
  profitRate: number | null
}

export interface SalesDashboardData {
  cards: SalesSummaryCard[]
  comparison: SalesComparisonData
  rows: MarketplaceSalesRow[]
  totals: MarketplaceSalesRow
  currentMonthLabel: string
}

export interface SalesComparisonData {
  currentSamePeriodSales: number
  rows: SalesComparisonRow[]
}

export interface SalesComparisonRow {
  monthLabel: string
  totalSales: number
  samePeriodSales: number
  differenceFromCurrent: number
  changeRate: number | null
}

type MetricRow = {
  monthSales: string | number | null
  shippedExpectedSales: string | number | null
  currentProfitExcludingShipping: string | number | null
  currentPeriodSales: string | number | null
  lastMonthSamePeriodSales: string | number | null
  previousThreeMonthAverageSales: string | number | null
}

type DetailRow = {
  marketplaceId: string
  marketplaceName: string | null
  sales: string | number | null
  marketplaceFee: string | number | null
  productCost: string | number | null
  paidShippingFee: string | number | null
  actualShippingFee: string | number | null
}

type MonthComparisonQueryRow = {
  totalSales: string | number | null
  samePeriodSales: string | number | null
}

const STATUS_FILTER = sql`('new', 'confirmed', 'preparing', 'ready', 'shipped', 'delivering', 'delivered')`

export async function getSalesDashboardData(userId: string, now = new Date()): Promise<SalesDashboardData> {
  await ensureActualShippingCostsTable()

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthSameDayEnd = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate() + 1)
  const previousThreeMonthStart = new Date(now.getFullYear(), now.getMonth() - 3, 1)

  const metricRows = await db.execute<MetricRow>(sql`
    WITH current_orders AS (
      SELECT
        o.id,
        o.total_amount::numeric AS total_amount,
        COALESCE(o.shipping_fee::numeric, 0) AS shipping_fee,
        COALESCE(NULLIF(mc.metadata->>'salesFeePercent', '')::numeric, 0) AS fee_percent
      FROM orders o
      LEFT JOIN marketplace_connections mc ON mc.id = o.connection_id
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${monthStart}
        AND o.ordered_at < ${nextMonthStart}
        AND o.status::text IN ${STATUS_FILTER}
    ),
    current_costs AS (
      SELECT
        COALESCE(SUM(oi.quantity * COALESCE(oi.sku_multiplier, 1) * COALESCE(p.cost_price::numeric, 0)), 0) AS product_cost
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p
        ON p.user_id = o.user_id
       AND p.internal_sku = COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${monthStart}
        AND o.ordered_at < ${nextMonthStart}
        AND o.status::text IN ${STATUS_FILTER}
    ),
    shipped_orders AS (
      SELECT DISTINCT o.id, o.total_amount::numeric AS total_amount
      FROM orders o
      JOIN shipments s ON s.order_id = o.id
      WHERE o.user_id = ${userId}
        AND s.shipped_at >= ${monthStart}
        AND s.shipped_at < ${nextMonthStart}
        AND o.status::text IN ${STATUS_FILTER}
    ),
    previous_months AS (
      SELECT
        to_char(o.ordered_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS month_key,
        SUM(o.total_amount::numeric) AS sales
      FROM orders o
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${previousThreeMonthStart}
        AND o.ordered_at < ${monthStart}
        AND o.status::text IN ${STATUS_FILTER}
      GROUP BY to_char(o.ordered_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')
    )
    SELECT
      COALESCE((SELECT SUM(total_amount) FROM current_orders), 0)::text AS "monthSales",
      COALESCE((SELECT SUM(total_amount) FROM shipped_orders), 0)::text AS "shippedExpectedSales",
      (
        COALESCE((SELECT SUM(total_amount - shipping_fee - (total_amount * fee_percent / 100)) FROM current_orders), 0)
        - COALESCE((SELECT product_cost FROM current_costs), 0)
      )::text AS "currentProfitExcludingShipping",
      COALESCE((SELECT SUM(total_amount) FROM current_orders), 0)::text AS "currentPeriodSales",
      COALESCE((
        SELECT SUM(o.total_amount::numeric)
        FROM orders o
        WHERE o.user_id = ${userId}
          AND o.ordered_at >= ${lastMonthStart}
          AND o.ordered_at < ${lastMonthSameDayEnd}
          AND o.status::text IN ${STATUS_FILTER}
      ), 0)::text AS "lastMonthSamePeriodSales",
      COALESCE((SELECT AVG(sales) FROM previous_months), 0)::text AS "previousThreeMonthAverageSales"
  `)
  const metric = resultRows(metricRows)[0]

  const detailRows = await db.execute<DetailRow>(sql`
    WITH order_base AS (
      SELECT
        o.id,
        o.marketplace_id,
        COALESCE(NULLIF(mc.display_name, ''), o.marketplace_id) AS marketplace_name,
        o.total_amount::numeric AS total_amount,
        COALESCE(o.shipping_fee::numeric, 0) AS paid_shipping_fee,
        COALESCE(NULLIF(mc.metadata->>'salesFeePercent', '')::numeric, 0) AS fee_percent
      FROM orders o
      LEFT JOIN marketplace_connections mc ON mc.id = o.connection_id
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${monthStart}
        AND o.ordered_at < ${nextMonthStart}
        AND o.status::text IN ${STATUS_FILTER}
    ),
    product_costs AS (
      SELECT
        o.marketplace_id,
        COALESCE(SUM(oi.quantity * COALESCE(oi.sku_multiplier, 1) * COALESCE(p.cost_price::numeric, 0)), 0) AS product_cost
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p
        ON p.user_id = o.user_id
       AND p.internal_sku = COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${monthStart}
        AND o.ordered_at < ${nextMonthStart}
        AND o.status::text IN ${STATUS_FILTER}
      GROUP BY o.marketplace_id
    ),
    actual_costs AS (
      SELECT
        o.marketplace_id,
        COALESCE(SUM(ascost.actual_fee::numeric), 0) AS actual_shipping_fee
      FROM actual_shipping_costs ascost
      JOIN shipments s ON s.id = ascost.shipment_id
      JOIN orders o ON o.id = s.order_id
      WHERE ascost.user_id = ${userId}
        AND o.ordered_at >= ${monthStart}
        AND o.ordered_at < ${nextMonthStart}
        AND o.status::text IN ${STATUS_FILTER}
      GROUP BY o.marketplace_id
    )
    SELECT
      ob.marketplace_id AS "marketplaceId",
      MAX(ob.marketplace_name) AS "marketplaceName",
      COALESCE(SUM(ob.total_amount), 0)::text AS sales,
      COALESCE(SUM(ob.total_amount * ob.fee_percent / 100), 0)::text AS "marketplaceFee",
      COALESCE(MAX(pc.product_cost), 0)::text AS "productCost",
      COALESCE(SUM(ob.paid_shipping_fee), 0)::text AS "paidShippingFee",
      COALESCE(MAX(ac.actual_shipping_fee), 0)::text AS "actualShippingFee"
    FROM order_base ob
    LEFT JOIN product_costs pc ON pc.marketplace_id = ob.marketplace_id
    LEFT JOIN actual_costs ac ON ac.marketplace_id = ob.marketplace_id
    GROUP BY ob.marketplace_id
    ORDER BY SUM(ob.total_amount) DESC
  `)

  const rows = resultRows(detailRows).map(toMarketplaceRow)
  const totals = buildTotals(rows)
  const currentSales = toNumber(metric?.currentPeriodSales)
  const lastMonthSamePeriod = toNumber(metric?.lastMonthSamePeriodSales)
  const previousThreeAverage = toNumber(metric?.previousThreeMonthAverageSales)
  const comparison = await getSalesComparisonData(userId, now, currentSales)

  return {
    currentMonthLabel: monthLabel(now),
    cards: [
      {
        key: 'month-sales',
        label: '당월매출',
        value: toNumber(metric?.monthSales),
        subLabel: '주문일 기준 실시간',
      },
      {
        key: 'shipped-expected',
        label: '당월 출고완료 매출예상금액',
        value: toNumber(metric?.shippedExpectedSales),
        subLabel: '출고일 기준',
      },
      {
        key: 'profit-excluding-shipping',
        label: '배송비 제외 현 이익금',
        value: toNumber(metric?.currentProfitExcludingShipping),
        subLabel: '매출 - 수수료 - 상품원가 - 결제배송비',
      },
      {
        key: 'last-month-same-period',
        label: '지난달 동기간 대비',
        value: percentChange(currentSales, lastMonthSamePeriod),
        suffix: '%',
        subLabel: `지난달 동기간 ${formatWon(lastMonthSamePeriod)}`,
      },
      {
        key: 'three-month-average',
        label: '직전 3개월 평균 대비',
        value: percentChange(toNumber(metric?.monthSales), previousThreeAverage),
        suffix: '%',
        subLabel: `3개월 평균 ${formatWon(previousThreeAverage)}`,
      },
    ],
    comparison,
    rows,
    totals,
  }
}

export function emptySalesDashboardData(now = new Date()): SalesDashboardData {
  return {
    currentMonthLabel: monthLabel(now),
    cards: [
      { key: 'month-sales', label: '당월매출', value: 0, subLabel: '주문일 기준 실시간' },
      { key: 'shipped-expected', label: '당월 출고완료 매출예상금액', value: 0, subLabel: '출고일 기준' },
      { key: 'profit-excluding-shipping', label: '배송비 제외 현 이익금', value: 0, subLabel: '매출 - 수수료 - 상품원가 - 결제배송비' },
      { key: 'last-month-same-period', label: '지난달 동기간 대비', value: 0, suffix: '%', subLabel: '지난달 동기간 0원' },
      { key: 'three-month-average', label: '직전 3개월 평균 대비', value: 0, suffix: '%', subLabel: '3개월 평균 0원' },
    ],
    comparison: { currentSamePeriodSales: 0, rows: [] },
    rows: [],
    totals: buildTotals([]),
  }
}

async function getSalesComparisonData(
  userId: string,
  now: Date,
  currentSamePeriodSales: number,
): Promise<SalesComparisonData> {
  const monthSpecs = [1, 2, 3].map((offset) => {
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 1)
    const samePeriodEnd = new Date(now.getFullYear(), now.getMonth() - offset, now.getDate() + 1)
    return {
      label: `${start.getMonth() + 1}월`,
      start,
      end,
      samePeriodEnd: samePeriodEnd > end ? end : samePeriodEnd,
    }
  }).reverse()

  const rows = await Promise.all(monthSpecs.map(async (spec) => {
    const result = await db.execute<MonthComparisonQueryRow>(sql`
      SELECT
        COALESCE(SUM(o.total_amount::numeric), 0)::text AS "totalSales",
        COALESCE(SUM(o.total_amount::numeric) FILTER (WHERE o.ordered_at < ${spec.samePeriodEnd}), 0)::text AS "samePeriodSales"
      FROM orders o
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${spec.start}
        AND o.ordered_at < ${spec.end}
        AND o.status::text IN ${STATUS_FILTER}
    `)
    const row = resultRows(result)[0]
    const totalSales = toNumber(row?.totalSales)
    const samePeriodSales = toNumber(row?.samePeriodSales)
    return {
      monthLabel: spec.label,
      totalSales,
      samePeriodSales,
      differenceFromCurrent: currentSamePeriodSales - samePeriodSales,
      changeRate: samePeriodSales > 0 ? percentChange(currentSamePeriodSales, samePeriodSales) : null,
    }
  }))

  return { currentSamePeriodSales, rows }
}

function toMarketplaceRow(row: DetailRow): MarketplaceSalesRow {
  const sales = toNumber(row.sales)
  const marketplaceFee = toNumber(row.marketplaceFee)
  const productCost = toNumber(row.productCost)
  const paidShippingFee = toNumber(row.paidShippingFee)
  const actualShippingFee = toNumber(row.actualShippingFee)
  const boxCost = 0
  const shippingMargin = paidShippingFee - actualShippingFee
  const finalProfit = sales - marketplaceFee - productCost + shippingMargin - boxCost
  return {
    marketplaceId: row.marketplaceId,
    marketplaceName: row.marketplaceName || row.marketplaceId,
    sales,
    marketplaceFee,
    productCost,
    paidShippingFee,
    actualShippingFee,
    shippingMargin,
    boxCost,
    finalProfit,
    profitRate: sales > 0 ? (finalProfit / sales) * 100 : null,
  }
}

function buildTotals(rows: MarketplaceSalesRow[]): MarketplaceSalesRow {
  const totals = rows.reduce<MarketplaceSalesRow>((acc, row) => {
    acc.sales += row.sales
    acc.marketplaceFee += row.marketplaceFee
    acc.productCost += row.productCost
    acc.paidShippingFee += row.paidShippingFee
    acc.actualShippingFee += row.actualShippingFee
    acc.shippingMargin += row.shippingMargin
    acc.boxCost += row.boxCost
    acc.finalProfit += row.finalProfit
    return acc
  }, {
    marketplaceId: 'total',
    marketplaceName: '합계',
    sales: 0,
    marketplaceFee: 0,
    productCost: 0,
    paidShippingFee: 0,
    actualShippingFee: 0,
    shippingMargin: 0,
    boxCost: 0,
    finalProfit: 0,
    profitRate: null,
  })
  totals.profitRate = totals.sales > 0 ? (totals.finalProfit / totals.sales) * 100 : null
  return totals
}

function toNumber(value: string | number | null | undefined): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function resultRows<T>(result: T[] | { rows?: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows ?? []
}

function percentChange(current: number, base: number): number {
  if (base === 0) return current > 0 ? 100 : 0
  return ((current - base) / base) * 100
}

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function monthLabel(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`
}
