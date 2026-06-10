import { sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'

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

export interface OrderProfitRow {
  orderId: string
  internalNo: string
  marketplaceOrderId: string
  marketplaceName: string
  orderedAt: Date
  productSummary: string
  skuSummary: string
  packageSummary: string
  trackingSummary: string
  sales: number
  marketplaceFee: number
  productCost: number
  paidShippingFee: number
  actualShippingFee: number
  boxCost: number
  finalProfit: number
  profitRate: number | null
  missingFee: boolean
  missingProductCost: boolean
  missingActualShipping: boolean
  missingPackaging: boolean
}

export interface ProfitMissingSummary {
  totalOrders: number
  completeOrders: number
  incompleteOrders: number
  missingFeeOrders: number
  missingProductCostOrders: number
  missingActualShippingOrders: number
  missingPackagingOrders: number
}

export interface OrderProfitAnalysisData {
  rows: OrderProfitRow[]
  summary: ProfitMissingSummary
  page: number
  pageSize: number
  totalPages: number
  missingOnly: boolean
  selectedIssue: ProfitMissingIssue
  currentMonthLabel: string
}

export type ProfitMissingIssue = 'all' | 'fee' | 'product-cost' | 'actual-shipping' | 'packaging'

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
  boxCost: string | number | null
}

type MonthComparisonQueryRow = {
  monthKey: string
  totalSales: string | number | null
  samePeriodSales: string | number | null
}

type OrderProfitQueryRow = {
  orderId: string
  internalNo: string
  marketplaceOrderId: string
  marketplaceName: string | null
  orderedAt: Date
  productSummary: string | null
  skuSummary: string | null
  packageSummary: string | null
  trackingSummary: string | null
  sales: string | number | null
  marketplaceFee: string | number | null
  productCost: string | number | null
  paidShippingFee: string | number | null
  actualShippingFee: string | number | null
  boxCost: string | number | null
  missingFee: boolean
  missingProductCost: boolean
  missingActualShipping: boolean
  missingPackaging: boolean
}

type ProfitMissingSummaryQueryRow = {
  totalOrders: string | number | null
  completeOrders: string | number | null
  incompleteOrders: string | number | null
  missingFeeOrders: string | number | null
  missingProductCostOrders: string | number | null
  missingActualShippingOrders: string | number | null
  missingPackagingOrders: string | number | null
}

const STATUS_FILTER = sql`('new', 'confirmed', 'preparing', 'ready', 'shipped', 'delivering', 'delivered')`
const ORDER_PROFIT_PAGE_SIZE = 50

export async function getOrderProfitAnalysisData(
  userId: string,
  options: { page?: number; missingOnly?: boolean; issue?: ProfitMissingIssue; now?: Date } = {},
): Promise<OrderProfitAnalysisData> {
  const now = options.now ?? new Date()
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const missingOnly = options.missingOnly ?? false
  const selectedIssue = options.issue ?? 'all'
  const monthStart = sqlDate(new Date(now.getFullYear(), now.getMonth(), 1))
  const nextMonthStart = sqlDate(new Date(now.getFullYear(), now.getMonth() + 1, 1))
  const offset = (page - 1) * ORDER_PROFIT_PAGE_SIZE
  const missingFilter = selectedIssue === 'fee'
    ? sql`AND missing_fee`
    : selectedIssue === 'product-cost'
      ? sql`AND missing_product_cost`
      : selectedIssue === 'actual-shipping'
        ? sql`AND missing_actual_shipping`
        : selectedIssue === 'packaging'
          ? sql`AND missing_packaging`
          : missingOnly
            ? sql`AND (missing_fee OR missing_product_cost OR missing_actual_shipping OR missing_packaging)`
            : sql``

  const baseQuery = sql`
    WITH marketplace_fee_settings AS (
      SELECT
        user_id,
        marketplace_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE NULLIF(metadata->>'salesFeePercent', '') IS NULL) = 0
            AND COUNT(DISTINCT NULLIF(metadata->>'salesFeePercent', '')::numeric) = 1
            THEN MAX(NULLIF(metadata->>'salesFeePercent', '')::numeric)
          ELSE NULL
        END AS fallback_fee_percent,
        CASE WHEN COUNT(*) = 1 THEN MAX(display_name) ELSE NULL END AS fallback_display_name,
        CASE WHEN COUNT(*) = 1 THEN MAX(NULLIF(metadata->>'systemMarketplaceName', '')) ELSE NULL END AS fallback_system_name,
        CASE WHEN COUNT(*) = 1 THEN MAX(NULLIF(metadata->>'salesExportMarketplaceId', '')) ELSE NULL END AS fallback_sales_export_id
      FROM marketplace_connections
      WHERE user_id = ${userId}
      GROUP BY user_id, marketplace_id
    ),
    inventory_packaging AS (
      SELECT
        i.user_id,
        i.sku,
        MAX(NULLIF(BTRIM(i.packaging_unit), '')) AS packaging_unit
      FROM inventory i
      WHERE i.user_id = ${userId}
      GROUP BY i.user_id, i.sku
    ),
    item_summary AS (
      SELECT
        o.id AS order_id,
        STRING_AGG(DISTINCT COALESCE(NULLIF(oi.locked_product_name, ''), oi.product_name), ', ') AS product_summary,
        STRING_AGG(DISTINCT COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''), '미매핑'), ', ') AS sku_summary,
        COALESCE(SUM(
          COALESCE(oi.locked_quantity, oi.quantity * COALESCE(oi.sku_multiplier, 1))
          * COALESCE(p.cost_price::numeric, 0)
        ), 0) AS product_cost,
        BOOL_OR(
          COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) IS NULL
          OR p.id IS NULL
          OR p.cost_price IS NULL
        ) AS missing_product_cost,
        CASE
          WHEN COUNT(DISTINCT ip.packaging_unit) = 1 AND BOOL_AND(ip.packaging_unit IS NOT NULL)
            THEN MAX(ip.packaging_unit)
          ELSE NULL
        END AS fallback_package_name
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p
        ON p.user_id = o.user_id
       AND p.internal_sku = COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
      LEFT JOIN inventory_packaging ip
        ON ip.user_id = o.user_id
       AND ip.sku = COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${monthStart}
        AND o.ordered_at < ${nextMonthStart}
        AND o.status::text IN ${STATUS_FILTER}
      GROUP BY o.id
    ),
    shipment_summary AS (
      SELECT
        s.order_id,
        COUNT(DISTINCT s.id) AS shipment_count,
        STRING_AGG(DISTINCT s.tracking_number, ', ') AS tracking_summary,
        STRING_AGG(DISTINCT COALESCE(resolved.package_name, '박스명 없음'), ', ') AS package_summary,
        COALESCE(SUM(ascost.actual_fee::numeric), 0) AS actual_shipping_fee,
        COUNT(DISTINCT s.id) FILTER (WHERE ascost.id IS NULL) AS unmatched_shipment_count,
        COALESCE(SUM(
          COALESCE(rate.unit_cost, 0) * GREATEST(COALESCE(ascost.quantity, 1), 1)
        ), 0) AS box_cost,
        COUNT(DISTINCT s.id) FILTER (
          WHERE resolved.package_name IS NULL OR rate.unit_cost IS NULL
        ) AS missing_box_cost_count
      FROM shipments s
      LEFT JOIN actual_shipping_costs ascost ON ascost.shipment_id = s.id
      LEFT JOIN item_summary items ON items.order_id = s.order_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(BTRIM(ascost.package_type), ''), items.fallback_package_name) AS package_name
      ) resolved ON true
      LEFT JOIN LATERAL (
        SELECT bcr.unit_cost::numeric AS unit_cost
        FROM box_cost_rates bcr
        WHERE bcr.user_id = ${userId}
          AND bcr.is_active = true
          AND LOWER(BTRIM(bcr.package_name)) = LOWER(BTRIM(resolved.package_name))
          AND bcr.effective_from <= (COALESCE(s.shipped_at, s.created_at) AT TIME ZONE 'Asia/Seoul')::date
        ORDER BY bcr.effective_from DESC
        LIMIT 1
      ) rate ON true
      WHERE s.user_id = ${userId}
      GROUP BY s.order_id
    ),
    profit_rows AS (
      SELECT
        o.id AS order_id,
        o.internal_no,
        o.marketplace_order_id,
        COALESCE(
          NULLIF(mc.metadata->>'systemMarketplaceName', ''),
          NULLIF(mfs.fallback_system_name, ''),
          NULLIF(mc.display_name, ''),
          NULLIF(mfs.fallback_display_name, ''),
          o.marketplace_id
        ) AS marketplace_name,
        o.ordered_at,
        COALESCE(items.product_summary, '상품정보 없음') AS product_summary,
        COALESCE(items.sku_summary, '미매핑') AS sku_summary,
        COALESCE(shipments.package_summary, '박스명 없음') AS package_summary,
        COALESCE(shipments.tracking_summary, '송장 없음') AS tracking_summary,
        o.total_amount::numeric AS sales,
        (
          o.total_amount::numeric
          * COALESCE(NULLIF(mc.metadata->>'salesFeePercent', '')::numeric, mfs.fallback_fee_percent, 0)
          / 100
        ) AS marketplace_fee,
        COALESCE(items.product_cost, 0) AS product_cost,
        COALESCE(o.shipping_fee::numeric, 0) AS paid_shipping_fee,
        COALESCE(shipments.actual_shipping_fee, 0) AS actual_shipping_fee,
        COALESCE(shipments.box_cost, 0) AS box_cost,
        COALESCE(NULLIF(mc.metadata->>'salesFeePercent', '')::numeric, mfs.fallback_fee_percent) IS NULL AS missing_fee,
        COALESCE(items.missing_product_cost, true) AS missing_product_cost,
        COALESCE(shipments.shipment_count, 0) = 0
          OR COALESCE(shipments.unmatched_shipment_count, 0) > 0 AS missing_actual_shipping,
        COALESCE(shipments.shipment_count, 0) = 0
          OR COALESCE(shipments.missing_box_cost_count, 0) > 0 AS missing_packaging
      FROM orders o
      LEFT JOIN marketplace_connections mc ON mc.id = o.connection_id
      LEFT JOIN marketplace_fee_settings mfs
        ON mfs.user_id = o.user_id
       AND mfs.marketplace_id = o.marketplace_id
      LEFT JOIN item_summary items ON items.order_id = o.id
      LEFT JOIN shipment_summary shipments ON shipments.order_id = o.id
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${monthStart}
        AND o.ordered_at < ${nextMonthStart}
        AND o.status::text IN ${STATUS_FILTER}
    )
  `

  const [summaryResult, rowsResult] = await Promise.all([
    db.execute<ProfitMissingSummaryQueryRow>(sql`
      ${baseQuery}
      SELECT
        COUNT(*)::text AS "totalOrders",
        COUNT(*) FILTER (
          WHERE NOT missing_fee
            AND NOT missing_product_cost
            AND NOT missing_actual_shipping
            AND NOT missing_packaging
        )::text AS "completeOrders",
        COUNT(*) FILTER (
          WHERE missing_fee OR missing_product_cost OR missing_actual_shipping OR missing_packaging
        )::text AS "incompleteOrders",
        COUNT(*) FILTER (WHERE missing_fee)::text AS "missingFeeOrders",
        COUNT(*) FILTER (WHERE missing_product_cost)::text AS "missingProductCostOrders",
        COUNT(*) FILTER (WHERE missing_actual_shipping)::text AS "missingActualShippingOrders",
        COUNT(*) FILTER (WHERE missing_packaging)::text AS "missingPackagingOrders"
      FROM profit_rows
    `),
    db.execute<OrderProfitQueryRow>(sql`
      ${baseQuery}
      SELECT
        order_id AS "orderId",
        internal_no AS "internalNo",
        marketplace_order_id AS "marketplaceOrderId",
        marketplace_name AS "marketplaceName",
        ordered_at AS "orderedAt",
        product_summary AS "productSummary",
        sku_summary AS "skuSummary",
        package_summary AS "packageSummary",
        tracking_summary AS "trackingSummary",
        sales::text AS sales,
        marketplace_fee::text AS "marketplaceFee",
        product_cost::text AS "productCost",
        paid_shipping_fee::text AS "paidShippingFee",
        actual_shipping_fee::text AS "actualShippingFee",
        box_cost::text AS "boxCost",
        missing_fee AS "missingFee",
        missing_product_cost AS "missingProductCost",
        missing_actual_shipping AS "missingActualShipping",
        missing_packaging AS "missingPackaging"
      FROM profit_rows
      WHERE true
      ${missingFilter}
      ORDER BY ordered_at DESC, internal_no DESC
      LIMIT ${ORDER_PROFIT_PAGE_SIZE}
      OFFSET ${offset}
    `),
  ])

  const summaryRow = resultRows(summaryResult)[0]
  const summary = toProfitMissingSummary(summaryRow)
  const filteredTotal = selectedIssue === 'fee'
    ? summary.missingFeeOrders
    : selectedIssue === 'product-cost'
      ? summary.missingProductCostOrders
      : selectedIssue === 'actual-shipping'
        ? summary.missingActualShippingOrders
        : selectedIssue === 'packaging'
          ? summary.missingPackagingOrders
          : missingOnly ? summary.incompleteOrders : summary.totalOrders

  return {
    rows: resultRows(rowsResult).map(toOrderProfitRow),
    summary,
    page,
    pageSize: ORDER_PROFIT_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(filteredTotal / ORDER_PROFIT_PAGE_SIZE)),
    missingOnly,
    selectedIssue,
    currentMonthLabel: monthLabel(now),
  }
}

export const getCachedOrderProfitAnalysisData = unstable_cache(
  async (
    userId: string,
    page: number,
    missingOnly: boolean,
    issue: ProfitMissingIssue,
  ) => getOrderProfitAnalysisData(userId, { page, missingOnly, issue }),
  ['order-profit-analysis'],
  { revalidate: 30 },
)

export function emptyOrderProfitAnalysisData(
  options: { page?: number; missingOnly?: boolean; issue?: ProfitMissingIssue; now?: Date } = {},
): OrderProfitAnalysisData {
  const now = options.now ?? new Date()
  return {
    rows: [],
    summary: {
      totalOrders: 0,
      completeOrders: 0,
      incompleteOrders: 0,
      missingFeeOrders: 0,
      missingProductCostOrders: 0,
      missingActualShippingOrders: 0,
      missingPackagingOrders: 0,
    },
    page: Math.max(1, options.page ?? 1),
    pageSize: ORDER_PROFIT_PAGE_SIZE,
    totalPages: 1,
    missingOnly: options.missingOnly ?? false,
    selectedIssue: options.issue ?? 'all',
    currentMonthLabel: monthLabel(now),
  }
}

export async function getSalesDashboardData(userId: string, now = new Date()): Promise<SalesDashboardData> {
  const monthStart = sqlDate(new Date(now.getFullYear(), now.getMonth(), 1))
  const nextMonthStart = sqlDate(new Date(now.getFullYear(), now.getMonth() + 1, 1))
  const lastMonthStart = sqlDate(new Date(now.getFullYear(), now.getMonth() - 1, 1))
  const lastMonthSameDayEnd = sqlDate(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate() + 1))
  const previousThreeMonthStart = sqlDate(new Date(now.getFullYear(), now.getMonth() - 3, 1))

  const metricRowsPromise = db.execute<MetricRow>(sql`
    WITH marketplace_fee_settings AS (
      SELECT
        user_id,
        marketplace_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE NULLIF(metadata->>'salesFeePercent', '') IS NULL) = 0
            AND COUNT(DISTINCT NULLIF(metadata->>'salesFeePercent', '')::numeric) = 1
            THEN MAX(NULLIF(metadata->>'salesFeePercent', '')::numeric)
          ELSE NULL
        END AS fallback_fee_percent
      FROM marketplace_connections
      WHERE user_id = ${userId}
      GROUP BY user_id, marketplace_id
    ),
    current_orders AS (
      SELECT
        o.id,
        o.total_amount::numeric AS total_amount,
        COALESCE(o.shipping_fee::numeric, 0) AS shipping_fee,
        COALESCE(NULLIF(mc.metadata->>'salesFeePercent', '')::numeric, mfs.fallback_fee_percent, 0) AS fee_percent
      FROM orders o
      LEFT JOIN marketplace_connections mc ON mc.id = o.connection_id
      LEFT JOIN marketplace_fee_settings mfs
        ON mfs.user_id = o.user_id
       AND mfs.marketplace_id = o.marketplace_id
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
  const detailRowsPromise = db.execute<DetailRow>(sql`
    WITH marketplace_fee_settings AS (
      SELECT
        user_id,
        marketplace_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE NULLIF(metadata->>'salesFeePercent', '') IS NULL) = 0
            AND COUNT(DISTINCT NULLIF(metadata->>'salesFeePercent', '')::numeric) = 1
            THEN MAX(NULLIF(metadata->>'salesFeePercent', '')::numeric)
          ELSE NULL
        END AS fallback_fee_percent,
        CASE WHEN COUNT(*) = 1 THEN MAX(display_name) ELSE NULL END AS fallback_display_name,
        CASE WHEN COUNT(*) = 1 THEN MAX(NULLIF(metadata->>'systemMarketplaceName', '')) ELSE NULL END AS fallback_system_name,
        CASE WHEN COUNT(*) = 1 THEN MAX(NULLIF(metadata->>'salesExportMarketplaceId', '')) ELSE NULL END AS fallback_sales_export_id
      FROM marketplace_connections
      WHERE user_id = ${userId}
      GROUP BY user_id, marketplace_id
    ),
    order_base AS (
      SELECT
        o.id,
        o.marketplace_id || ':' || COALESCE(
          NULLIF(mc.metadata->>'salesExportMarketplaceId', ''),
          o.connection_id::text,
          mfs.fallback_sales_export_id,
          'unlinked'
        ) AS account_key,
        COALESCE(
          NULLIF(mc.metadata->>'systemMarketplaceName', ''),
          NULLIF(mfs.fallback_system_name, ''),
          NULLIF(mc.display_name, ''),
          NULLIF(mfs.fallback_display_name, ''),
          o.marketplace_id
        ) AS marketplace_name,
        o.total_amount::numeric AS total_amount,
        COALESCE(o.shipping_fee::numeric, 0) AS paid_shipping_fee,
        COALESCE(NULLIF(mc.metadata->>'salesFeePercent', '')::numeric, mfs.fallback_fee_percent, 0) AS fee_percent
      FROM orders o
      LEFT JOIN marketplace_connections mc ON mc.id = o.connection_id
      LEFT JOIN marketplace_fee_settings mfs
        ON mfs.user_id = o.user_id
       AND mfs.marketplace_id = o.marketplace_id
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${monthStart}
        AND o.ordered_at < ${nextMonthStart}
        AND o.status::text IN ${STATUS_FILTER}
    ),
    product_costs AS (
      SELECT
        ob.account_key,
        COALESCE(SUM(oi.quantity * COALESCE(oi.sku_multiplier, 1) * COALESCE(p.cost_price::numeric, 0)), 0) AS product_cost
      FROM order_base ob
      JOIN orders o ON o.id = ob.id
      JOIN order_items oi ON oi.order_id = ob.id
      LEFT JOIN products p
        ON p.user_id = o.user_id
       AND p.internal_sku = COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
      GROUP BY ob.account_key
    ),
    order_packaging AS (
      SELECT
        o.id AS order_id,
        CASE
          WHEN COUNT(DISTINCT NULLIF(BTRIM(i.packaging_unit), '')) = 1
            AND BOOL_AND(NULLIF(BTRIM(i.packaging_unit), '') IS NOT NULL)
            THEN MAX(NULLIF(BTRIM(i.packaging_unit), ''))
          ELSE NULL
        END AS fallback_package_name
      FROM order_base ob
      JOIN orders o ON o.id = ob.id
      JOIN order_items oi ON oi.order_id = ob.id
      LEFT JOIN inventory i
        ON i.user_id = o.user_id
       AND i.sku = COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''))
      GROUP BY o.id
    ),
    shipment_costs AS (
      SELECT
        ob.account_key,
        COALESCE(SUM(ascost.actual_fee::numeric), 0) AS actual_shipping_fee,
        COALESCE(SUM(
          COALESCE(rate.unit_cost, 0) * GREATEST(COALESCE(ascost.quantity, 1), 1)
        ), 0) AS box_cost
      FROM shipments s
      JOIN orders o ON o.id = s.order_id
      JOIN order_base ob ON ob.id = o.id
      LEFT JOIN actual_shipping_costs ascost ON ascost.shipment_id = s.id
      LEFT JOIN order_packaging op ON op.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(BTRIM(ascost.package_type), ''), op.fallback_package_name) AS package_name
      ) resolved ON true
      LEFT JOIN LATERAL (
        SELECT bcr.unit_cost::numeric AS unit_cost
        FROM box_cost_rates bcr
        WHERE bcr.user_id = ${userId}
          AND bcr.is_active = true
          AND LOWER(BTRIM(bcr.package_name)) = LOWER(BTRIM(resolved.package_name))
          AND bcr.effective_from <= (COALESCE(s.shipped_at, s.created_at) AT TIME ZONE 'Asia/Seoul')::date
        ORDER BY bcr.effective_from DESC
        LIMIT 1
      ) rate ON true
      WHERE s.user_id = ${userId}
      GROUP BY ob.account_key
    )
    SELECT
      ob.account_key AS "marketplaceId",
      MAX(ob.marketplace_name) AS "marketplaceName",
      COALESCE(SUM(ob.total_amount), 0)::text AS sales,
      COALESCE(SUM(ob.total_amount * ob.fee_percent / 100), 0)::text AS "marketplaceFee",
      COALESCE(MAX(pc.product_cost), 0)::text AS "productCost",
      COALESCE(SUM(ob.paid_shipping_fee), 0)::text AS "paidShippingFee",
      COALESCE(MAX(sc.actual_shipping_fee), 0)::text AS "actualShippingFee",
      COALESCE(MAX(sc.box_cost), 0)::text AS "boxCost"
    FROM order_base ob
    LEFT JOIN product_costs pc ON pc.account_key = ob.account_key
    LEFT JOIN shipment_costs sc ON sc.account_key = ob.account_key
    GROUP BY ob.account_key
    ORDER BY SUM(ob.total_amount) DESC
  `)

  const metricRows = await metricRowsPromise
  const metric = resultRows(metricRows)[0]
  const currentSales = toNumber(metric?.currentPeriodSales)
  const comparisonPromise = getSalesComparisonData(userId, now, currentSales)
  const detailRows = await detailRowsPromise
  const rows = resultRows(detailRows).map(toMarketplaceRow)
  const totals = buildTotals(rows)
  const lastMonthSamePeriod = toNumber(metric?.lastMonthSamePeriodSales)
  const previousThreeAverage = toNumber(metric?.previousThreeMonthAverageSales)
  const comparison = await comparisonPromise

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

export const getCachedSalesDashboardData = unstable_cache(
  async (userId: string) => getSalesDashboardData(userId),
  ['sales-dashboard'],
  { revalidate: 30 },
)

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
      start: sqlDate(start),
      end: sqlDate(end),
      samePeriodEnd: sqlDate(samePeriodEnd > end ? end : samePeriodEnd),
    }
  }).reverse()

  const comparisonResult = await db.execute<MonthComparisonQueryRow>(sql`
    WITH comparison_months(month_key, month_start, month_end, same_period_end) AS (
      VALUES
        ${sql.join(monthSpecs.map((spec) => sql`(
          ${spec.label},
          ${spec.start}::timestamptz,
          ${spec.end}::timestamptz,
          ${spec.samePeriodEnd}::timestamptz
        )`), sql`, `)}
    )
    SELECT
      cm.month_key AS "monthKey",
      COALESCE(SUM(o.total_amount::numeric), 0)::text AS "totalSales",
      COALESCE(SUM(o.total_amount::numeric) FILTER (WHERE o.ordered_at < cm.same_period_end), 0)::text AS "samePeriodSales"
    FROM comparison_months cm
    LEFT JOIN orders o
      ON o.user_id = ${userId}
     AND o.ordered_at >= cm.month_start
     AND o.ordered_at < cm.month_end
     AND o.status::text IN ${STATUS_FILTER}
    GROUP BY cm.month_key, cm.month_start
    ORDER BY cm.month_start
  `)

  const rows = resultRows(comparisonResult).map((row) => {
    const totalSales = toNumber(row?.totalSales)
    const samePeriodSales = toNumber(row?.samePeriodSales)
    return {
      monthLabel: row.monthKey,
      totalSales,
      samePeriodSales,
      differenceFromCurrent: currentSamePeriodSales - samePeriodSales,
      changeRate: samePeriodSales > 0 ? percentChange(currentSamePeriodSales, samePeriodSales) : null,
    }
  })

  return { currentSamePeriodSales, rows }
}

function toMarketplaceRow(row: DetailRow): MarketplaceSalesRow {
  const sales = toNumber(row.sales)
  const marketplaceFee = toNumber(row.marketplaceFee)
  const productCost = toNumber(row.productCost)
  const paidShippingFee = toNumber(row.paidShippingFee)
  const actualShippingFee = toNumber(row.actualShippingFee)
  const boxCost = toNumber(row.boxCost)
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

function toOrderProfitRow(row: OrderProfitQueryRow): OrderProfitRow {
  const sales = toNumber(row.sales)
  const marketplaceFee = toNumber(row.marketplaceFee)
  const productCost = toNumber(row.productCost)
  const paidShippingFee = toNumber(row.paidShippingFee)
  const actualShippingFee = toNumber(row.actualShippingFee)
  const boxCost = toNumber(row.boxCost)
  const finalProfit = sales - marketplaceFee - productCost + paidShippingFee - actualShippingFee - boxCost

  return {
    orderId: row.orderId,
    internalNo: row.internalNo,
    marketplaceOrderId: row.marketplaceOrderId,
    marketplaceName: row.marketplaceName || '-',
    orderedAt: new Date(row.orderedAt),
    productSummary: row.productSummary || '상품정보 없음',
    skuSummary: row.skuSummary || '미매핑',
    packageSummary: row.packageSummary || '박스명 없음',
    trackingSummary: row.trackingSummary || '송장 없음',
    sales,
    marketplaceFee,
    productCost,
    paidShippingFee,
    actualShippingFee,
    boxCost,
    finalProfit,
    profitRate: sales > 0 ? (finalProfit / sales) * 100 : null,
    missingFee: Boolean(row.missingFee),
    missingProductCost: Boolean(row.missingProductCost),
    missingActualShipping: Boolean(row.missingActualShipping),
    missingPackaging: Boolean(row.missingPackaging),
  }
}

function toProfitMissingSummary(row: ProfitMissingSummaryQueryRow | undefined): ProfitMissingSummary {
  return {
    totalOrders: toNumber(row?.totalOrders),
    completeOrders: toNumber(row?.completeOrders),
    incompleteOrders: toNumber(row?.incompleteOrders),
    missingFeeOrders: toNumber(row?.missingFeeOrders),
    missingProductCostOrders: toNumber(row?.missingProductCostOrders),
    missingActualShippingOrders: toNumber(row?.missingActualShippingOrders),
    missingPackagingOrders: toNumber(row?.missingPackagingOrders),
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

function sqlDate(value: Date): string {
  return value.toISOString()
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
