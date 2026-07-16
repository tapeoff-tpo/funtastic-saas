import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getProductProfitAnalysisData } from '@/lib/analytics/sales-dashboard'
import type {
  MonthlyProductMetrics,
  ProductMasterData,
  ProductOpportunitySource,
} from './types'

type ProductMasterRow = {
  sku: string
  productName: string
  categoryId: string | null
  basePrice: string | number | null
  costPrice: string | number | null
  images: ProductMasterData['images'] | null
  metadata: Record<string, unknown> | null
  optionNames: string[] | null
  currentStock: string | number | null
}

type ReturnRow = {
  month: string
  sku: string
  returnOrderCount: string | number | null
}

type BehaviorRow = {
  sku: string
  stockoutEventCount: string | number | null
  repeatBuyerRate: string | number | null
}

type UserRow = {
  userId: string
}

export type OpportunitySourceResult = {
  userId: string
  asOfDate: Date
  products: ProductOpportunitySource[]
  warnings: string[]
}

export async function loadOpportunitySource(input: {
  userId?: string
  asOfDate?: Date
  includeCurrentMonth?: boolean
} = {}): Promise<OpportunitySourceResult> {
  const userId = input.userId ?? await resolveWorkspaceUserId()
  const requestedAsOf = input.asOfDate ?? new Date()
  const asOfDate = input.includeCurrentMonth
    ? requestedAsOf
    : new Date(requestedAsOf.getFullYear(), requestedAsOf.getMonth(), 0, 23, 59, 59, 999)
  const months = monthStarts(asOfDate, 12)
  const warnings: string[] = []

  const [monthlyProfitRows, masterRows, returnRows, behaviorRows] = await Promise.all([
    Promise.all(months.map(async (month) => {
      const result = await getProductProfitAnalysisData(userId, {
        now: month,
        sort: 'sales',
        direction: 'desc',
      })
      if (result.rows.length >= 1000) {
        warnings.push(`${monthKey(month)} reached the 1000-row analytics limit; lower-ranked SKUs may be omitted.`)
      }
      return { month: monthKey(month), rows: result.rows }
    })),
    loadProductMaster(userId),
    loadReturnRows(userId, months[0], nextMonth(months.at(-1)!)),
    loadBehaviorRows(userId, months[0], nextMonth(months.at(-1)!)),
  ])

  const masterBySku = new Map(masterRows.map((row) => [row.sku, row]))
  const returnsByMonthSku = new Map(
    returnRows.map((row) => [`${row.month}:${row.sku}`, toNumber(row.returnOrderCount)]),
  )
  const behaviorBySku = new Map(behaviorRows.map((row) => [row.sku, row]))
  const allSkus = new Set(masterRows.map((row) => row.sku))
  for (const monthly of monthlyProfitRows) {
    for (const row of monthly.rows) allSkus.add(row.sku)
  }

  const products = [...allSkus].sort().map((sku) => {
    const master = masterBySku.get(sku) ?? emptyMaster(sku)
    const behavior = behaviorBySku.get(sku)
    const monthly = monthlyProfitRows.map(({ month, rows }) => {
      const row = rows.find((item) => item.sku === sku)
      return {
        month,
        quantity: row?.quantity ?? 0,
        orderCount: row?.orderCount ?? 0,
        sales: row?.sales ?? 0,
        productCost: row?.productCost ?? 0,
        marketplaceFee: row?.marketplaceFee ?? 0,
        paidShippingFee: row?.paidShippingFee ?? 0,
        actualShippingFee: row?.actualShippingFee ?? 0,
        boxCost: row?.boxCost ?? 0,
        finalProfit: row?.finalProfit ?? 0,
        returnOrderCount: returnsByMonthSku.get(`${month}:${sku}`) ?? 0,
      } satisfies MonthlyProductMetrics
    })
    return {
      ...master,
      stockoutEventCount: behavior ? toNumber(behavior.stockoutEventCount) : null,
      repeatBuyerRate: behavior?.repeatBuyerRate == null ? null : toNumber(behavior.repeatBuyerRate),
      monthly,
    }
  })

  return { userId, asOfDate, products, warnings }
}

async function resolveWorkspaceUserId(): Promise<string> {
  const adminResult = await db.execute<UserRow>(sql`
    SELECT id::text AS "userId"
    FROM user_profiles
    WHERE deactivated_at IS NULL
      AND (email ILIKE 'admin123%' OR display_name ILIKE 'admin123%')
    ORDER BY created_at
    LIMIT 1
  `)
  const admin = resultRows(adminResult)[0]
  if (admin?.userId) return admin.userId

  const orderResult = await db.execute<UserRow>(sql`
    SELECT user_id::text AS "userId"
    FROM orders
    GROUP BY user_id
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `)
  const owner = resultRows(orderResult)[0]
  if (owner?.userId) return owner.userId
  throw new Error('Workspace user could not be resolved. Pass --user-id explicitly.')
}

async function loadProductMaster(userId: string): Promise<ProductMasterData[]> {
  const result = await db.execute<ProductMasterRow>(sql`
    SELECT
      p.internal_sku AS sku,
      p.name AS "productName",
      p.category_id AS "categoryId",
      p.base_price AS "basePrice",
      p.cost_price AS "costPrice",
      p.images,
      p.metadata,
      COALESCE(
        (
          SELECT ARRAY_AGG(DISTINCT NULLIF(BTRIM(pv.option_name), '') ORDER BY NULLIF(BTRIM(pv.option_name), ''))
          FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
        ),
        ARRAY[]::text[]
      ) AS "optionNames",
      (
        SELECT COALESCE(SUM(i.available_stock), 0)
        FROM inventory i
        WHERE i.user_id = p.user_id AND i.sku = p.internal_sku
      )::text AS "currentStock"
    FROM products p
    WHERE p.user_id = ${userId}
      AND p.status::text <> 'deleted'
    ORDER BY p.internal_sku
  `)
  return resultRows(result).map((row) => ({
    sku: row.sku,
    productName: row.productName,
    optionNames: row.optionNames ?? [],
    categoryId: row.categoryId,
    basePrice: nullableNumber(row.basePrice),
    costPrice: nullableNumber(row.costPrice),
    currentStock: nullableNumber(row.currentStock),
    images: Array.isArray(row.images) ? row.images : [],
    metadata: row.metadata ?? {},
    stockoutEventCount: null,
    repeatBuyerRate: null,
  }))
}

async function loadReturnRows(userId: string, start: Date, end: Date): Promise<ReturnRow[]> {
  const result = await db.execute<ReturnRow>(sql`
    SELECT
      TO_CHAR(o.ordered_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS month,
      COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, ''), '미매핑') AS sku,
      COUNT(DISTINCT o.id)::text AS "returnOrderCount"
    FROM claims c
    JOIN orders o ON o.id = c.order_id
    JOIN order_items oi ON oi.order_id = o.id
    WHERE c.user_id = ${userId}
      AND c.claim_type::text = 'return'
      AND c.claim_status::text <> 'rejected'
      AND o.ordered_at >= ${start}
      AND o.ordered_at < ${end}
    GROUP BY month, sku
  `)
  return resultRows(result)
}

async function loadBehaviorRows(userId: string, start: Date, end: Date): Promise<BehaviorRow[]> {
  const result = await db.execute<BehaviorRow>(sql`
    WITH stockouts AS (
      SELECT
        i.sku,
        COUNT(*) FILTER (WHERE ih.new_total <= 0)::numeric AS stockout_events
      FROM inventory i
      LEFT JOIN inventory_history ih
        ON ih.inventory_id = i.id
       AND ih.created_at >= ${start}
       AND ih.created_at < ${end}
      WHERE i.user_id = ${userId}
      GROUP BY i.sku
    ),
    customer_orders AS (
      SELECT DISTINCT
        COALESCE(NULLIF(oi.locked_sku, ''), NULLIF(oi.sku, '')) AS sku,
        o.id AS order_id,
        NULLIF(CONCAT_WS('|',
          NULLIF(BTRIM(o.buyer_phone2), ''),
          NULLIF(BTRIM(o.buyer_phone), ''),
          NULLIF(BTRIM(o.buyer_name), '')
        ), '') AS customer_key
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.user_id = ${userId}
        AND o.ordered_at >= ${start}
        AND o.ordered_at < ${end}
        AND o.status::text IN ('new', 'confirmed', 'preparing', 'ready', 'shipped', 'delivering', 'delivered')
    ),
    buyer_counts AS (
      SELECT sku, customer_key, COUNT(DISTINCT order_id) AS orders
      FROM customer_orders
      WHERE sku IS NOT NULL AND customer_key IS NOT NULL
      GROUP BY sku, customer_key
    ),
    repeats AS (
      SELECT
        sku,
        CASE WHEN COUNT(*) > 0
          THEN COUNT(*) FILTER (WHERE orders > 1)::numeric / COUNT(*)
          ELSE NULL
        END AS repeat_buyer_rate
      FROM buyer_counts
      GROUP BY sku
    )
    SELECT
      COALESCE(s.sku, r.sku) AS sku,
      s.stockout_events::text AS "stockoutEventCount",
      r.repeat_buyer_rate::text AS "repeatBuyerRate"
    FROM stockouts s
    FULL OUTER JOIN repeats r ON r.sku = s.sku
  `)
  return resultRows(result)
}

function emptyMaster(sku: string): ProductMasterData {
  return {
    sku,
    productName: '상품명 없음',
    optionNames: [],
    categoryId: null,
    basePrice: null,
    costPrice: null,
    currentStock: null,
    images: [],
    metadata: {},
    stockoutEventCount: null,
    repeatBuyerRate: null,
  }
}

function monthStarts(asOfDate: Date, count: number): Date[] {
  const latest = new Date(asOfDate.getFullYear(), asOfDate.getMonth(), 1)
  return Array.from({ length: count }, (_, index) => (
    new Date(latest.getFullYear(), latest.getMonth() - (count - 1 - index), 1)
  ))
}

function nextMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function nullableNumber(value: string | number | null): number | null {
  if (value == null || value === '') return null
  return toNumber(value)
}

function toNumber(value: string | number | null) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function resultRows<T>(result: T[] | { rows?: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows ?? []
}
