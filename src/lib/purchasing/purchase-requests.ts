import { and, asc, count, desc, eq, getTableColumns, gt, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  chinaWarehouseInventory,
  chinaWarehouseInventoryMovements,
  products,
  purchaseRequestItems,
} from '@/lib/db/schema'
import { calculatePurchaseCosts, sumPurchaseCosts } from './purchase-costs'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import {
  PURCHASE_DELAY_TRACKING_START_DATE,
  purchaseDelayReasonToItemStatus,
  type PurchaseDelayReason,
} from './purchase-delay'
import { PURCHASE_URL_HEADER } from './items'
import {
  type PurchasePaymentStatus,
  type PurchaseRequestStatus,
} from './purchase-request-status'
import { ensurePurchasePaymentTrackingSchema } from './purchase-payment-tracking'

const CHINA_INVENTORY_WAREHOUSE_ORDER = [
  '부품관리',
  '브랜드',
  '스마일배송(개인个人1688)',
  '원재료 창고',
  '중국발생비용 (中国产生费用)',
  '중국창고',
] as const

const ACTIVE_PURCHASE_PAYMENT_STATUSES = [
  'purchased',
  'purchase_completed',
  'china_arrived',
  'outbound_requested',
] as const

export type PurchaseCostSummary = {
  itemCount: number
  totalCostYuan: number
  totalCostKrw: number
  missingYuanCostCount: number
  missingKrwCostCount: number
}

export type PurchasePaymentFlowSummary = {
  total: PurchaseCostSummary
  purchaseBefore: PurchaseCostSummary
  purchaseCompleted: PurchaseCostSummary
  outstanding: PurchaseCostSummary
}

export const PURCHASE_PAYMENT_FLOW_VIEWS = [
  'total',
  'purchase_before',
  'purchase_completed',
  'outstanding',
] as const

export type PurchasePaymentFlowView = (typeof PURCHASE_PAYMENT_FLOW_VIEWS)[number]

export const PURCHASE_PAYMENT_FLOW_SORTS = ['totalCostYuan', 'totalCostKrw'] as const
export type PurchasePaymentFlowSort = (typeof PURCHASE_PAYMENT_FLOW_SORTS)[number]

export const PURCHASE_PAYMENT_FLOW_VIEW_LABELS: Record<PurchasePaymentFlowView, string> = {
  total: '발주금액 총액',
  purchase_before: '발주요청',
  purchase_completed: '구매 완료',
  outstanding: '결제 대기 (미결제 잔액)',
}

type PurchaseCostRow = {
  status: PurchaseRequestStatus
  paymentStatus?: string | null
  requestedQuantity: number
  actualPurchaseQuantity: number | null
  specialPriceCny: string | null
  newCostCny: string | null
  costExchangeRateKrw: string | null
}

export type PurchasePaymentFlowDetailItem = {
  id: string
  status: PurchaseRequestStatus
  paymentStatus: PurchasePaymentStatus
  paymentPaidAt: Date | null
  sku: string
  productName: string
  optionName: string | null
  quantity: number
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
  requestDate: string | null
  outboundExpectedDate: string | null
  unitCostYuan: number | null
  unitCostKrw: number | null
  totalCostYuan: number | null
  totalCostKrw: number | null
}

export type PurchasePaymentFlowData = {
  summary: PurchasePaymentFlowSummary
  items: PurchasePaymentFlowDetailItem[]
}

export type PurchasePaymentFlowDetailPage = {
  items: PurchasePaymentFlowDetailItem[]
}

export async function getPurchasePaymentFlowSummary(
  userId: string,
  fallbackExchangeRateKrw: number,
): Promise<PurchasePaymentFlowSummary> {
  await ensurePurchasePaymentTrackingSchema()
  const costs = purchasePaymentFlowCostSqlExpressions(fallbackExchangeRateKrw)
  const hasSupplierOrderNumber = hasSupplierOrderNumberSql()
  const summaryRows = await db
    .select({
      status: purchaseRequestItems.status,
      hasSupplierOrderNumber,
      itemCount: count(),
      totalCostYuan: sql<number>`COALESCE(SUM(COALESCE(${costs.totalCostYuan}, 0)), 0)`,
      totalCostKrw: sql<number>`COALESCE(SUM(COALESCE(${costs.totalCostKrw}, 0)), 0)`,
      missingYuanCostCount: sql<number>`COUNT(*) FILTER (WHERE ${costs.totalCostYuan} IS NULL)`,
      missingKrwCostCount: sql<number>`COUNT(*) FILTER (WHERE ${costs.totalCostKrw} IS NULL)`,
    })
    .from(purchaseRequestItems)
    .leftJoin(products, and(
      eq(products.userId, purchaseRequestItems.userId),
      eq(products.internalSku, purchaseRequestItems.sku),
    ))
    .where(and(
      eq(purchaseRequestItems.userId, userId),
      inArray(purchaseRequestItems.status, [...ACTIVE_PURCHASE_PAYMENT_STATUSES]),
    ))
    .groupBy(purchaseRequestItems.status, hasSupplierOrderNumber)

  return summarizePurchasePaymentFlowGroups(summaryRows)
}

export async function getPurchasePaymentFlowData(
  userId: string,
  fallbackExchangeRateKrw: number,
): Promise<PurchasePaymentFlowData> {
  await ensurePurchasePaymentTrackingSchema()
  const rows = await db
    .select({
      id: purchaseRequestItems.id,
      status: purchaseRequestItems.status,
      paymentStatus: purchaseRequestItems.paymentStatus,
      paymentPaidAt: purchaseRequestItems.paymentPaidAt,
      sku: purchaseRequestItems.sku,
      productName: purchaseRequestItems.productName,
      optionName: purchaseRequestItems.optionName,
      requestedQuantity: purchaseRequestItems.requestedQuantity,
      actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
      purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
      supplierOrderNumber: purchaseRequestItems.supplierOrderNumber,
      requestDate: purchaseRequestItems.requestDate,
      outboundExpectedDate: purchaseRequestItems.outboundExpectedDate,
      specialPriceCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'특가(元)', '')`,
      newCostCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
      costExchangeRateKrw: purchaseRequestItems.costExchangeRateKrw,
    })
    .from(purchaseRequestItems)
    .leftJoin(products, and(
      eq(products.userId, purchaseRequestItems.userId),
      eq(products.internalSku, purchaseRequestItems.sku),
    ))
    .where(and(
      eq(purchaseRequestItems.userId, userId),
      inArray(purchaseRequestItems.status, [...ACTIVE_PURCHASE_PAYMENT_STATUSES]),
    ))
    .orderBy(desc(purchaseRequestItems.updatedAt), desc(purchaseRequestItems.createdAt), asc(purchaseRequestItems.sku))

  const summary = Object.fromEntries(
    PURCHASE_PAYMENT_FLOW_VIEWS.map((view) => [
      view,
      summarizePurchaseCosts(rows.filter((row) => isPurchasePaymentFlowViewItem(row, view)), fallbackExchangeRateKrw),
    ]),
  ) as Record<PurchasePaymentFlowView, PurchaseCostSummary>

  return {
    summary: {
      total: summary.total,
      purchaseBefore: summary.purchase_before,
      purchaseCompleted: summary.purchase_completed,
      outstanding: summary.outstanding,
    },
    items: rows.map((row) => {
      const costs = calculatePurchaseCost(row, fallbackExchangeRateKrw)
      return {
        id: row.id,
        status: row.status,
        paymentStatus: normalizePaymentStatus(row.paymentStatus),
        paymentPaidAt: row.paymentPaidAt,
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
        quantity: purchaseCostQuantity(row),
        purchaseManagementCode: row.purchaseManagementCode,
        supplierOrderNumber: row.supplierOrderNumber,
        requestDate: row.requestDate,
        outboundExpectedDate: row.outboundExpectedDate,
        ...costs,
      }
    }),
  }
}

export async function getPurchasePaymentFlowDetailPage(input: {
  userId: string
  fallbackExchangeRateKrw: number
  view: PurchasePaymentFlowView
  page: number
  pageSize: number
  sort: PurchasePaymentFlowSort | null | undefined
  order: 'asc' | 'desc'
}): Promise<PurchasePaymentFlowDetailPage> {
  await ensurePurchasePaymentTrackingSchema()
  const page = positiveIntegerOr(input.page, 1)
  const pageSize = Math.min(200, positiveIntegerOr(input.pageSize, 50))
  const where = paymentFlowDetailWhere(input.userId, input.view)
  const orderBy = paymentFlowDetailOrderBy(input.sort, input.order, input.fallbackExchangeRateKrw)

  const rows = await db
    .select({
      id: purchaseRequestItems.id,
      status: purchaseRequestItems.status,
      paymentStatus: purchaseRequestItems.paymentStatus,
      paymentPaidAt: purchaseRequestItems.paymentPaidAt,
      sku: purchaseRequestItems.sku,
      productName: purchaseRequestItems.productName,
      optionName: purchaseRequestItems.optionName,
      requestedQuantity: purchaseRequestItems.requestedQuantity,
      actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
      purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
      supplierOrderNumber: purchaseRequestItems.supplierOrderNumber,
      requestDate: purchaseRequestItems.requestDate,
      outboundExpectedDate: purchaseRequestItems.outboundExpectedDate,
      specialPriceCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'특가(元)', '')`,
      newCostCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
      costExchangeRateKrw: purchaseRequestItems.costExchangeRateKrw,
    })
    .from(purchaseRequestItems)
    .leftJoin(products, and(
      eq(products.userId, purchaseRequestItems.userId),
      eq(products.internalSku, purchaseRequestItems.sku),
    ))
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    items: rows.map((row) => {
      const costs = calculatePurchaseCost(row, input.fallbackExchangeRateKrw)
      return {
        id: row.id,
        status: row.status,
        paymentStatus: normalizePaymentStatus(row.paymentStatus),
        paymentPaidAt: row.paymentPaidAt,
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
        quantity: purchaseCostQuantity(row),
        purchaseManagementCode: row.purchaseManagementCode,
        supplierOrderNumber: row.supplierOrderNumber,
        requestDate: row.requestDate,
        outboundExpectedDate: row.outboundExpectedDate,
        ...costs,
      }
    }),
  }
}

export function isPurchasePaymentFlowViewItem(
  item: {
    status: PurchaseRequestStatus
    supplierOrderNumber?: string | null
    hasSupplierOrderNumber?: boolean
    paymentStatus?: string | null
  },
  view: PurchasePaymentFlowView,
) {
  const hasSupplierOrderNumber = item.hasSupplierOrderNumber
    ?? Boolean(item.supplierOrderNumber?.trim())

  if (view === 'total') return true
  if (view === 'purchase_completed') return hasSupplierOrderNumber
  if (view === 'purchase_before') return item.status === 'purchased' && !hasSupplierOrderNumber
  return !hasSupplierOrderNumber
}

export function filterPurchasePaymentFlowItems(
  items: PurchasePaymentFlowDetailItem[],
  view: PurchasePaymentFlowView,
) {
  return items.filter((item) => isPurchasePaymentFlowViewItem(item, view))
}

export function sortPurchasePaymentFlowItems(
  items: PurchasePaymentFlowDetailItem[],
  sort: PurchasePaymentFlowSort | null | undefined,
  order: 'asc' | 'desc' = 'desc',
) {
  if (!sort) return items

  const direction = order === 'asc' ? 1 : -1
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftCost = left.item[sort]
      const rightCost = right.item[sort]
      if (leftCost === null) return rightCost === null ? left.index - right.index : 1
      if (rightCost === null) return -1
      const difference = leftCost - rightCost
      return difference === 0 ? left.index - right.index : difference * direction
    })
    .map(({ item }) => item)
}

export function getPurchasePaymentFlowViewSummary(
  summary: PurchasePaymentFlowSummary,
  view: PurchasePaymentFlowView,
): PurchaseCostSummary {
  switch (view) {
    case 'purchase_before':
      return summary.purchaseBefore
    case 'purchase_completed':
      return summary.purchaseCompleted
    case 'outstanding':
      return summary.outstanding
    default:
      return summary.total
  }
}

type PurchasePaymentFlowSummaryGroup = {
  status: PurchaseRequestStatus
  hasSupplierOrderNumber: boolean
  itemCount: number | string
  totalCostYuan: number | string
  totalCostKrw: number | string
  missingYuanCostCount: number | string
  missingKrwCostCount: number | string
}

function summarizePurchasePaymentFlowGroups(rows: PurchasePaymentFlowSummaryGroup[]): PurchasePaymentFlowSummary {
  const summaries = Object.fromEntries(
    PURCHASE_PAYMENT_FLOW_VIEWS.map((view) => [view, emptyPurchaseCostSummary()]),
  ) as Record<PurchasePaymentFlowView, PurchaseCostSummary>

  for (const row of rows) {
    const groupSummary = {
      itemCount: wholeNumber(row.itemCount),
      totalCostYuan: finiteNumber(row.totalCostYuan),
      totalCostKrw: finiteNumber(row.totalCostKrw),
      missingYuanCostCount: wholeNumber(row.missingYuanCostCount),
      missingKrwCostCount: wholeNumber(row.missingKrwCostCount),
    }

    for (const view of PURCHASE_PAYMENT_FLOW_VIEWS) {
      if (!isPurchasePaymentFlowViewItem(row, view)) continue
      addPurchaseCostSummary(summaries[view], groupSummary)
    }
  }

  for (const summary of Object.values(summaries)) {
    summary.totalCostYuan = Math.round(summary.totalCostYuan * 100) / 100
    summary.totalCostKrw = Math.round(summary.totalCostKrw)
  }

  return {
    total: summaries.total,
    purchaseBefore: summaries.purchase_before,
    purchaseCompleted: summaries.purchase_completed,
    outstanding: summaries.outstanding,
  }
}

function emptyPurchaseCostSummary(): PurchaseCostSummary {
  return {
    itemCount: 0,
    totalCostYuan: 0,
    totalCostKrw: 0,
    missingYuanCostCount: 0,
    missingKrwCostCount: 0,
  }
}

function addPurchaseCostSummary(target: PurchaseCostSummary, source: PurchaseCostSummary) {
  target.itemCount += source.itemCount
  target.totalCostYuan += source.totalCostYuan
  target.totalCostKrw += source.totalCostKrw
  target.missingYuanCostCount += source.missingYuanCostCount
  target.missingKrwCostCount += source.missingKrwCostCount
}

function finiteNumber(value: number | string | null | undefined) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function wholeNumber(value: number | string | null | undefined) {
  return Math.max(0, Math.trunc(finiteNumber(value)))
}

function positiveIntegerOr(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}

function paymentFlowDetailWhere(userId: string, view: PurchasePaymentFlowView): SQL {
  const conditions: SQL[] = [
    eq(purchaseRequestItems.userId, userId),
    inArray(purchaseRequestItems.status, [...ACTIVE_PURCHASE_PAYMENT_STATUSES]),
  ]
  const hasSupplierOrderNumber = hasSupplierOrderNumberSql()

  if (view === 'purchase_before') {
    conditions.push(eq(purchaseRequestItems.status, 'purchased'))
    conditions.push(sql`NOT (${hasSupplierOrderNumber})`)
  } else if (view === 'purchase_completed') {
    conditions.push(hasSupplierOrderNumber)
  } else if (view === 'outstanding') {
    conditions.push(sql`NOT (${hasSupplierOrderNumber})`)
  }

  return and(...conditions) ?? sql`TRUE`
}

function paymentFlowDetailOrderBy(
  sort: PurchasePaymentFlowSort | null | undefined,
  order: 'asc' | 'desc',
  fallbackExchangeRateKrw: number,
): SQL[] {
  if (sort) {
    const costs = purchasePaymentFlowCostSqlExpressions(fallbackExchangeRateKrw)
    const totalCost = sort === 'totalCostYuan' ? costs.totalCostYuan : costs.totalCostKrw
    const costOrder = order === 'asc'
      ? sql`${totalCost} ASC NULLS LAST`
      : sql`${totalCost} DESC NULLS LAST`

    return [
      costOrder,
      desc(purchaseRequestItems.updatedAt),
      desc(purchaseRequestItems.createdAt),
      asc(purchaseRequestItems.sku),
      asc(purchaseRequestItems.id),
    ]
  }

  return [
    desc(purchaseRequestItems.updatedAt),
    desc(purchaseRequestItems.createdAt),
    asc(purchaseRequestItems.sku),
    asc(purchaseRequestItems.id),
  ]
}

function hasSupplierOrderNumberSql() {
  return sql<boolean>`NULLIF(BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')), '') IS NOT NULL`
}

function purchasePaymentFlowCostSqlExpressions(fallbackExchangeRateKrw: number) {
  const specialPriceCny = productMetadataCostCnySql('특가(元)')
  const newCostCny = productMetadataCostCnySql('신규원가(元)')
  const unitCostYuan = sql<number>`CASE
    WHEN ${specialPriceCny} > 0 THEN ${specialPriceCny}
    WHEN ${newCostCny} > 0 THEN ${newCostCny}
    ELSE NULL
  END`
  const quantity = sql<number>`GREATEST(0, COALESCE(
    ${purchaseRequestItems.actualPurchaseQuantity},
    ${purchaseRequestItems.requestedQuantity}
  ))`
  const baseExchangeRateKrw = sql<number>`COALESCE(
    ${purchaseRequestItems.costExchangeRateKrw},
    ${Number.isFinite(fallbackExchangeRateKrw) ? fallbackExchangeRateKrw : 0}
  )`
  const appliedExchangeRateKrw = sql<number>`CASE
    WHEN ${baseExchangeRateKrw} <= 0 THEN NULL
    ELSE ROUND(${baseExchangeRateKrw} * 1.05, 4)
  END`

  return {
    totalCostYuan: sql<number>`CASE
      WHEN ${unitCostYuan} IS NULL THEN NULL
      ELSE ${unitCostYuan} * ${quantity}
    END`,
    totalCostKrw: sql<number>`CASE
      WHEN ${unitCostYuan} IS NULL OR ${appliedExchangeRateKrw} IS NULL THEN NULL
      ELSE ROUND(${unitCostYuan} * ${quantity} * ${appliedExchangeRateKrw})
    END`,
  }
}

function productMetadataCostCnySql(field: '특가(元)' | '신규원가(元)') {
  const numericText = sql<string>`regexp_replace(
    COALESCE(${products.metadata}->'esa009m'->>${field}, ''),
    '[^0-9.-]',
    '',
    'g'
  )`
  return sql<number>`CASE
    WHEN ${numericText} ~ '^-?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)$' THEN ${numericText}::numeric
    ELSE NULL
  END`
}

function summarizePurchaseCosts(rows: PurchaseCostRow[], fallbackExchangeRateKrw?: number): PurchaseCostSummary {
  return {
    itemCount: rows.length,
    ...sumPurchaseCosts(rows.map((row) => ({
      requestedQuantity: purchaseCostQuantity(row),
      specialPriceCny: row.specialPriceCny,
      newCostCny: row.newCostCny,
      exchangeRateKrw: row.costExchangeRateKrw ?? fallbackExchangeRateKrw,
    }))),
  }
}

function calculatePurchaseCost(row: PurchaseCostRow, fallbackExchangeRateKrw?: number) {
  return calculatePurchaseCosts({
    requestedQuantity: purchaseCostQuantity(row),
    specialPriceCny: row.specialPriceCny,
    newCostCny: row.newCostCny,
    exchangeRateKrw: row.costExchangeRateKrw ?? fallbackExchangeRateKrw,
  })
}

function purchaseCostQuantity(item: Pick<PurchaseCostRow, 'requestedQuantity' | 'actualPurchaseQuantity'>) {
  return item.actualPurchaseQuantity ?? item.requestedQuantity
}

function normalizePaymentStatus(value: string | null | undefined): PurchasePaymentStatus {
  if (value === 'paid' || value === 'before_outbound') return value
  return 'pending'
}

export async function getPurchaseRequests(input: {
  userId: string
  status?: PurchaseRequestStatus
  overdueOnly?: boolean
  search?: string
  page?: number
  pageSize?: number
  sort?: string
  order?: string
  /** Completed-outbound date groups selected in the list filter. */
  outboundDates?: readonly string[]
  exchangeRateKrw?: number
}) {
  await ensurePurchasePaymentTrackingSchema()
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 50
  const conditions: SQL[] = [eq(purchaseRequestItems.userId, input.userId)]

  if (input.overdueOnly) {
    if (input.status === 'purchased') {
      conditions.push(eq(purchaseRequestItems.status, 'purchased'))
      conditions.push(sql`${purchaseRequestItems.requestDate} IS NOT NULL`)
      conditions.push(sql`${purchaseRequestItems.requestDate} >= ${PURCHASE_DELAY_TRACKING_START_DATE}::date`)
      conditions.push(sql`${purchaseRequestItems.requestDate} <= CURRENT_DATE - INTERVAL '7 days'`)
    } else if (input.status === 'purchase_completed') {
      conditions.push(eq(purchaseRequestItems.status, 'purchase_completed'))
      conditions.push(sql`${purchaseRequestItems.outboundExpectedDate} IS NOT NULL`)
      conditions.push(sql`${purchaseRequestItems.outboundExpectedDate} <= CURRENT_DATE - INTERVAL '7 days'`)
    } else {
      conditions.push(or(
        and(
          eq(purchaseRequestItems.status, 'purchased'),
          sql`${purchaseRequestItems.requestDate} IS NOT NULL`,
          sql`${purchaseRequestItems.requestDate} >= ${PURCHASE_DELAY_TRACKING_START_DATE}::date`,
          sql`${purchaseRequestItems.requestDate} <= CURRENT_DATE - INTERVAL '7 days'`,
        ),
        and(
          eq(purchaseRequestItems.status, 'purchase_completed'),
          sql`${purchaseRequestItems.outboundExpectedDate} IS NOT NULL`,
          sql`${purchaseRequestItems.outboundExpectedDate} <= CURRENT_DATE - INTERVAL '7 days'`,
        ),
      )!)
    }
  } else if (input.status) {
    conditions.push(eq(purchaseRequestItems.status, input.status))
    if (input.status === 'requested') {
      conditions.push(gt(purchaseRequestItems.requestedQuantity, 0))
    }
  }
  if (input.status === 'completed' && input.outboundDates?.length) {
    conditions.push(inArray(
      purchaseRequestItems.outboundExpectedDate,
      [...new Set(input.outboundDates)],
    ))
  }
  if (input.search) {
    const pattern = `%${input.search}%`
    conditions.push(or(
      ilike(purchaseRequestItems.sku, pattern),
      ilike(purchaseRequestItems.productName, pattern),
      ilike(purchaseRequestItems.optionName, pattern),
      ilike(purchaseRequestItems.purchaseManagementCode, pattern),
      ilike(purchaseRequestItems.supplierOrderNumber, pattern),
    )!)
  }

  const where = and(...conditions)
  const orderBy = purchaseRequestOrderBy(input.sort, input.order, input.exchangeRateKrw)
  const overduePurchaseRequestConditions: SQL[] = [
    eq(purchaseRequestItems.userId, input.userId),
    eq(purchaseRequestItems.status, 'purchased'),
    sql`${purchaseRequestItems.requestDate} IS NOT NULL`,
    sql`${purchaseRequestItems.requestDate} >= ${PURCHASE_DELAY_TRACKING_START_DATE}::date`,
    sql`${purchaseRequestItems.requestDate} <= CURRENT_DATE - INTERVAL '7 days'`,
  ]
  const overduePurchaseCompletedConditions: SQL[] = [
    eq(purchaseRequestItems.userId, input.userId),
    eq(purchaseRequestItems.status, 'purchase_completed'),
    sql`${purchaseRequestItems.outboundExpectedDate} IS NOT NULL`,
    sql`${purchaseRequestItems.outboundExpectedDate} <= CURRENT_DATE - INTERVAL '7 days'`,
  ]
  if (input.search) {
    const pattern = `%${input.search}%`
    const searchCondition = or(
      ilike(purchaseRequestItems.sku, pattern),
      ilike(purchaseRequestItems.productName, pattern),
      ilike(purchaseRequestItems.optionName, pattern),
      ilike(purchaseRequestItems.purchaseManagementCode, pattern),
      ilike(purchaseRequestItems.supplierOrderNumber, pattern),
    )!
    overduePurchaseRequestConditions.push(searchCondition)
    overduePurchaseCompletedConditions.push(searchCondition)
  }
  const overduePurchaseRequestWhere = and(...overduePurchaseRequestConditions)
  const overduePurchaseCompletedWhere = and(...overduePurchaseCompletedConditions)
  const chinaCurrentStock = sql<number>`(
    SELECT COALESCE(${chinaWarehouseInventory.availableQuantity}, 0)::int
    FROM ${chinaWarehouseInventory}
    WHERE ${chinaWarehouseInventory.userId} = ${purchaseRequestItems.userId}
      AND ${chinaWarehouseInventory.sku} = ${purchaseRequestItems.sku}
      AND ${chinaWarehouseInventory.optionKey} = COALESCE(${purchaseRequestItems.optionName}, '')
    LIMIT 1
  )`
  const [items, [{ total }], statusCounts, costRows, overduePurchaseRequestRows, overduePurchaseCompletedRows] = await Promise.all([
    db
      .select({
        ...getTableColumns(purchaseRequestItems),
        specialPriceCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'특가(元)', '')`,
        newCostCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
        purchaseUrl: sql<string | null>`NULLIF(BTRIM(COALESCE(${products.metadata}->'esa009m'->>${PURCHASE_URL_HEADER}, '')), '')`,
        purchasingStatus: products.purchasingStatus,
        purchasingStatusNote: products.purchasingStatusNote,
        chinaCurrentStock,
      })
      .from(purchaseRequestItems)
      .leftJoin(products, and(
        eq(products.userId, purchaseRequestItems.userId),
        eq(products.internalSku, purchaseRequestItems.sku),
      ))
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(purchaseRequestItems).where(where),
    db
      .select({
        status: purchaseRequestItems.status,
        total: count(),
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        or(
          ne(purchaseRequestItems.status, 'requested'),
          gt(purchaseRequestItems.requestedQuantity, 0),
        ),
      ))
      .groupBy(purchaseRequestItems.status),
    db
      .select({
        status: purchaseRequestItems.status,
        sku: purchaseRequestItems.sku,
        productName: purchaseRequestItems.productName,
        requestedQuantity: purchaseRequestItems.requestedQuantity,
        actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
        specialPriceCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'특가(元)', '')`,
        newCostCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
        costExchangeRateKrw: purchaseRequestItems.costExchangeRateKrw,
      })
      .from(purchaseRequestItems)
      .leftJoin(products, and(
        eq(products.userId, purchaseRequestItems.userId),
        eq(products.internalSku, purchaseRequestItems.sku),
      ))
      .where(where),
    db.select({ total: count() }).from(purchaseRequestItems).where(overduePurchaseRequestWhere),
    db.select({ total: count() }).from(purchaseRequestItems).where(overduePurchaseCompletedWhere),
  ])
  const overduePurchaseRequestCount = overduePurchaseRequestRows[0]?.total ?? 0
  const overduePurchaseCompletedCount = overduePurchaseCompletedRows[0]?.total ?? 0
  const pricedItems = items.map((item) => ({
    ...item,
    ...calculatePurchaseCosts({
      requestedQuantity: purchaseCostQuantity(item),
      specialPriceCny: item.specialPriceCny,
      newCostCny: item.newCostCny,
      exchangeRateKrw: item.costExchangeRateKrw ?? input.exchangeRateKrw,
    }),
  }))
  const missingCostItems = costRows
    .map((row) => ({ row, costs: calculatePurchaseCost(row, input.exchangeRateKrw) }))
    .filter(({ costs }) => costs.unitCostYuan === null || costs.unitCostKrw === null)
    .map(({ row, costs }) => ({
      sku: row.sku,
      productName: row.productName,
      missingYuan: costs.unitCostYuan === null,
      missingKrw: costs.unitCostKrw === null,
    }))

  return {
    items: pricedItems,
    total,
    costTotals: summarizePurchaseCosts(costRows, input.exchangeRateKrw),
    missingCostItems,
    overduePurchasedCount: overduePurchaseCompletedCount,
    overduePurchaseRequestCount,
    overduePurchaseCompletedCount,
    overdueTotalCount: overduePurchaseRequestCount + overduePurchaseCompletedCount,
    statusCounts: Object.fromEntries(statusCounts.map((row) => [row.status, row.total])) as Partial<Record<PurchaseRequestStatus, number>>,
  }
}

export async function getCompletedOutboundDateOptions(userId: string) {
  return db
    .select({
      date: purchaseRequestItems.outboundExpectedDate,
      count: count(),
    })
    .from(purchaseRequestItems)
    .where(and(
      eq(purchaseRequestItems.userId, userId),
      eq(purchaseRequestItems.status, 'completed'),
      sql`${purchaseRequestItems.outboundExpectedDate} IS NOT NULL`,
    ))
    .groupBy(purchaseRequestItems.outboundExpectedDate)
    .orderBy(desc(purchaseRequestItems.outboundExpectedDate))
}

export async function updatePurchaseRequestStatus(input: {
  userId: string
  id: string
  status: PurchaseRequestStatus
}) {
  await ensurePurchasePaymentTrackingSchema()
  const exchangeRateReference = input.status === 'requested'
    ? null
    : await getLatestCnyKrwReferenceRate()

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!current) return null
    if (current.status === input.status) return { id: current.id }

    if (input.status === 'china_arrived') {
      await addChinaWarehouseStock(tx, current)
    }
    if (input.status === 'outbound_requested') {
      if (current.status === 'china_arrived') {
        await addChinaWarehouseStock(tx, current)
      }
      await subtractChinaWarehouseStock(tx, current)
    }
    if (input.status === 'completed') {
      if (current.status === 'china_arrived') {
        await addChinaWarehouseStock(tx, current)
      }
      await subtractChinaWarehouseStock(tx, current)
    }

    const values: Partial<typeof purchaseRequestItems.$inferInsert> = {
      status: input.status,
      updatedAt: new Date(),
    }
    if (input.status !== 'requested' && !current.costExchangeRateKrw && exchangeRateReference) {
      values.costExchangeRateKrw = String(exchangeRateReference.rate)
      values.costExchangeRateDate = exchangeRateReference.date ?? todayKstDate()
    }
    if (input.status === 'purchased') {
      values.requestDate = current.requestDate ?? todayKstDate()
      values.actualPurchaseQuantity = current.actualPurchaseQuantity ?? current.requestedQuantity
      if (!current.purchaseManagementCode) {
        const assignment = await nextPurchaseManagementAssignment(tx, current)
        values.sequence = assignment.sequence
        values.buyerCode = assignment.buyerCode
        values.buyerName = current.buyerName ?? assignment.buyerName
        values.purchaseManagementCode = assignment.purchaseManagementCode
      }
    }
    if (input.status === 'china_arrived') {
      values.chinaReceivedAt = current.chinaReceivedAt ?? new Date()
      values.chinaReceivedQuantity = current.chinaReceivedQuantity ?? purchaseQuantity(current)
    }

    const [row] = await tx
      .update(purchaseRequestItems)
      .set(values)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .returning({ id: purchaseRequestItems.id })

    return row ?? null
  })
}

export async function updatePurchaseRequestPlanFields(input: {
  userId: string
  id: string
  requestDate?: string | null
  requestedQuantity?: number
  actualPurchaseQuantity?: number | null
  chinaReceivedQuantity?: number | null
  outboundRequestedQuantity?: number | null
  supplierOrderNumber?: string | null
  outboundExpectedDate?: string | null
  purchaseMethod?: string | null
  purchaseConfirmed?: boolean
  paymentStatus?: PurchasePaymentStatus
  buyerCode?: string | null
  buyerName?: string | null
  delayReason?: PurchaseDelayReason | null
  delayNote?: string | null
  applyDelayReasonToItem?: boolean
}) {
  await ensurePurchasePaymentTrackingSchema()
  const requestedQuantity = normalizePurchaseRequestQuantity(input.requestedQuantity)
  const actualPurchaseQuantity = normalizeOptionalPurchaseRequestQuantity(input.actualPurchaseQuantity)
  const chinaReceivedQuantity = normalizeOptionalPurchaseRequestQuantity(input.chinaReceivedQuantity)
  const outboundRequestedQuantity = normalizeOptionalPurchaseRequestQuantity(input.outboundRequestedQuantity)
  if (requestedQuantity === null) return null
  if (actualPurchaseQuantity === null) return null
  if (chinaReceivedQuantity === null) return null
  if (outboundRequestedQuantity === null) return null
  const now = new Date()
  const exchangeRateReference = input.paymentStatus === undefined
    ? null
    : await getLatestCnyKrwReferenceRate()
  const values: Partial<typeof purchaseRequestItems.$inferInsert> = {
    updatedAt: now,
  }
  if (requestedQuantity !== undefined) values.requestedQuantity = requestedQuantity
  if (input.requestDate !== undefined) {
    values.requestDate = input.requestDate || null
  }
  if (actualPurchaseQuantity !== undefined) values.actualPurchaseQuantity = actualPurchaseQuantity
  if (chinaReceivedQuantity !== undefined) values.chinaReceivedQuantity = chinaReceivedQuantity
  if (input.supplierOrderNumber !== undefined) {
    values.supplierOrderNumber = emptyToNull(input.supplierOrderNumber)
  }
  if (input.outboundExpectedDate !== undefined) {
    values.outboundExpectedDate = input.outboundExpectedDate || null
  }
  if (input.purchaseMethod !== undefined) {
    values.purchaseMethod = emptyToNull(input.purchaseMethod)
  }
  if (input.purchaseConfirmed !== undefined) {
    values.purchaseConfirmed = input.purchaseConfirmed
  }
  if (input.paymentStatus !== undefined) {
    values.paymentStatus = input.paymentStatus
    values.paymentPaidAt = input.paymentStatus === 'paid' ? now : null
  }
  if (input.buyerCode !== undefined) {
    const buyerCode = normalizePurchaseBuyerCode(input.buyerCode)
    values.buyerCode = buyerCode
    values.buyerName = PURCHASE_BUYERS[buyerCode]
  } else if (input.buyerName !== undefined) {
    values.buyerName = emptyToNull(input.buyerName)
  }
  if (input.delayReason !== undefined) {
    values.delayReason = input.delayReason
    values.delayRecordedAt = input.delayReason ? now : null
    if (input.delayReason === null && input.delayNote === undefined) values.delayNote = null
  }
  if (input.delayNote !== undefined) {
    values.delayNote = emptyToNull(input.delayNote)
    if (input.delayReason === undefined) values.delayRecordedAt = values.delayNote ? now : null
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!current) return null

    if (input.paymentStatus !== undefined && !current.costExchangeRateKrw && exchangeRateReference) {
      values.costExchangeRateKrw = String(exchangeRateReference.rate)
      values.costExchangeRateDate = exchangeRateReference.date ?? todayKstDate()
    }

    if (outboundRequestedQuantity !== undefined) {
      values.rawData = {
        ...current.rawData,
        outboundRequestedQuantity,
      }
    }
    if (chinaReceivedQuantity !== undefined) {
      await adjustChinaWarehouseArrivalQuantity(tx, current, chinaReceivedQuantity)
    }
    if (outboundRequestedQuantity !== undefined && current.status === 'outbound_requested') {
      await adjustChinaWarehouseOutboundQuantity(tx, current, outboundRequestedQuantity)
    }

    const [row] = await tx
      .update(purchaseRequestItems)
      .set(values)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .returning({ id: purchaseRequestItems.id })

    if (!row) return null

    let excludedRecommendationCount = 0
    if (input.applyDelayReasonToItem && input.delayReason) {
      const purchasingStatus = purchaseDelayReasonToItemStatus(input.delayReason)
      await tx
        .update(products)
        .set({
          purchasingStatus,
          purchasingStatusNote: emptyToNull(input.delayNote),
          purchasingStatusUpdatedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(products.userId, input.userId),
          eq(products.internalSku, current.sku),
        ))

      if (purchasingStatus === 'discontinued') {
        const hiddenRows = await tx
          .update(purchaseRequestItems)
          .set({ requestedQuantity: 0, updatedAt: now })
          .where(and(
            eq(purchaseRequestItems.userId, input.userId),
            eq(purchaseRequestItems.sku, current.sku),
            eq(purchaseRequestItems.status, 'requested'),
            gt(purchaseRequestItems.requestedQuantity, 0),
            sql`${purchaseRequestItems.rawData}->>'source' = 'auto_purchase_recommendation'`,
          ))
          .returning({ id: purchaseRequestItems.id })
        excludedRecommendationCount = hiddenRows.length
      }
    }

    return { ...row, excludedRecommendationCount }
  })
}

export function normalizePurchaseRequestQuantity(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  const quantity = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(quantity) || quantity < 1) return null
  return quantity
}

export function normalizeOptionalPurchaseRequestQuantity(value: unknown) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const quantity = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(quantity) || quantity < 0) return null
  return quantity
}

export function getOutboundRequestedQuantity(item: {
  rawData: Record<string, unknown>
  chinaReceivedQuantity: number | null
  actualPurchaseQuantity: number | null
  requestedQuantity: number
}) {
  const rawQuantity = item.rawData.outboundRequestedQuantity
  const outboundRequestedQuantity = typeof rawQuantity === 'number' ? rawQuantity : Number(rawQuantity)
  if (Number.isInteger(outboundRequestedQuantity) && outboundRequestedQuantity >= 0) {
    return outboundRequestedQuantity
  }
  return item.chinaReceivedQuantity ?? item.actualPurchaseQuantity ?? item.requestedQuantity
}

export function purchaseRequestOrderBy(sort?: string, order?: string, fallbackExchangeRateKrw = 0): SQL[] {
  const direction = order === 'asc' ? asc : desc
  const specialPriceCny = sql<number>`NULLIF(regexp_replace(COALESCE(${products.metadata}->'esa009m'->>'특가(元)', ''), '[^0-9.-]', '', 'g'), '')::numeric`
  const newCostCny = sql<number>`NULLIF(regexp_replace(COALESCE(${products.metadata}->'esa009m'->>'신규원가(元)', ''), '[^0-9.-]', '', 'g'), '')::numeric`
  const unitCostYuan = sql<number>`CASE
    WHEN ${specialPriceCny} > 0 THEN ${specialPriceCny}
    WHEN ${newCostCny} > 0 THEN ${newCostCny}
    ELSE NULL
  END`
  const baseExchangeRateKrw = sql<number>`COALESCE(${purchaseRequestItems.costExchangeRateKrw}, ${fallbackExchangeRateKrw})`
  const unitCostKrw = sql<number>`CASE
    WHEN ${unitCostYuan} IS NULL OR ${baseExchangeRateKrw} <= 0 THEN NULL
    ELSE ROUND(${unitCostYuan} * ${baseExchangeRateKrw} * 1.05)
  END`
  const costQuantity = sql<number>`COALESCE(${purchaseRequestItems.actualPurchaseQuantity}, ${purchaseRequestItems.requestedQuantity})`
  const totalCostYuan = sql<number>`COALESCE(${unitCostYuan}, 0) * ${costQuantity}`
  const totalCostKrw = sql<number>`COALESCE(${unitCostKrw}, 0) * ${costQuantity}`
  const purchaseDate = sql<Date>`COALESCE(${purchaseRequestItems.requestDate}, ${purchaseRequestItems.createdAt}::date)`

  switch (sort) {
    case 'status':
      return [direction(purchaseRequestItems.status), desc(purchaseRequestItems.createdAt)]
    case 'productName':
      return [
        direction(purchaseRequestItems.productName),
        asc(purchaseRequestItems.sku),
        desc(purchaseRequestItems.createdAt),
      ]
    case 'sku':
      return [direction(purchaseRequestItems.sku), desc(purchaseRequestItems.createdAt)]
    case 'requestedQuantity':
      return [direction(purchaseRequestItems.requestedQuantity), desc(purchaseRequestItems.createdAt)]
    case 'unitCostYuan':
      return [direction(unitCostYuan), desc(purchaseRequestItems.createdAt)]
    case 'unitCostKrw':
      return [direction(unitCostKrw), desc(purchaseRequestItems.createdAt)]
    case 'totalCostYuan':
      return [direction(totalCostYuan), desc(purchaseRequestItems.createdAt)]
    case 'totalCostKrw':
      return [direction(totalCostKrw), desc(purchaseRequestItems.createdAt)]
    case 'purchaseManagementCode':
      return [direction(purchaseRequestItems.purchaseManagementCode), desc(purchaseRequestItems.createdAt)]
    case 'buyerName':
      return [direction(purchaseRequestItems.buyerName), desc(purchaseRequestItems.createdAt)]
    case 'createdAt':
      return [direction(purchaseRequestItems.createdAt)]
    default:
      return [
        desc(purchaseDate),
        asc(purchaseRequestItems.productName),
        asc(purchaseRequestItems.sku),
        asc(purchaseRequestItems.optionName),
        desc(purchaseRequestItems.createdAt),
      ]
  }
}

export async function deletePurchaseRequestItem(input: {
  userId: string
  id: string
}) {
  return db.transaction(async (tx) => {
    const [item] = await tx
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!item) return null

    const movements = await tx
      .select()
      .from(chinaWarehouseInventoryMovements)
      .where(and(
        eq(chinaWarehouseInventoryMovements.userId, input.userId),
        eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, input.id),
      ))

    for (const movement of movements) {
      await tx
        .update(chinaWarehouseInventory)
        .set({
          totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} - ${movement.delta}`,
          availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} - ${movement.delta}`,
          updatedAt: new Date(),
        })
        .where(eq(chinaWarehouseInventory.id, movement.inventoryId))
    }

    await tx
      .delete(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))

    await tx
      .delete(chinaWarehouseInventory)
      .where(and(
        eq(chinaWarehouseInventory.userId, input.userId),
        eq(chinaWarehouseInventory.totalQuantity, 0),
        eq(chinaWarehouseInventory.availableQuantity, 0),
      ))

    return { id: input.id }
  })
}

export async function getChinaWarehouseInventory(input: {
  userId: string
  search?: string
  page?: number
  pageSize?: number
}) {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 50
  const conditions: SQL[] = [
    eq(chinaWarehouseInventory.userId, input.userId),
    gt(chinaWarehouseInventory.availableQuantity, 0),
  ]
  if (input.search) {
    const pattern = `%${input.search}%`
    conditions.push(or(
      ilike(chinaWarehouseInventory.sku, pattern),
      ilike(chinaWarehouseInventory.productName, pattern),
      ilike(chinaWarehouseInventory.optionName, pattern),
    )!)
  }

  const where = and(...conditions)
  const [items, [{ total }], warehouseRows] = await Promise.all([
    db
      .select()
      .from(chinaWarehouseInventory)
      .where(where)
      .orderBy(asc(chinaWarehouseInventory.sku), asc(chinaWarehouseInventory.optionKey))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({
        total: count(),
      })
      .from(chinaWarehouseInventory)
      .where(where),
    db
      .select({ warehouseQuantities: chinaWarehouseInventory.warehouseQuantities })
      .from(chinaWarehouseInventory)
      .where(eq(chinaWarehouseInventory.userId, input.userId)),
  ])

  return {
    items,
    total,
    warehouseNames: sortChinaInventoryWarehouseNames(
      warehouseRows.flatMap((row) => Object.keys(row.warehouseQuantities)),
    ),
  }
}

function sortChinaInventoryWarehouseNames(warehouseNames: Iterable<string>) {
  const rankByName = new Map<string, number>(
    CHINA_INVENTORY_WAREHOUSE_ORDER.map((name, index): [string, number] => [name, index]),
  )
  return [...new Set(warehouseNames)].sort((left, right) => {
    const leftRank = rankByName.get(left) ?? Number.MAX_SAFE_INTEGER
    const rightRank = rankByName.get(right) ?? Number.MAX_SAFE_INTEGER
    return leftRank - rightRank || left.localeCompare(right, 'ko-KR')
  })
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type PurchaseRequestItem = typeof purchaseRequestItems.$inferSelect

async function addChinaWarehouseStock(tx: DbTransaction, item: PurchaseRequestItem) {
  const quantity = purchaseQuantity(item)
  if (quantity <= 0) return
  const optionKey = item.optionName ?? ''

  if (await hasChinaWarehouseMovement(tx, item.id, 'arrival')) return

  await tx
    .insert(chinaWarehouseInventory)
    .values({
      userId: item.userId,
      sku: item.sku,
      productName: item.productName,
      optionKey,
      optionName: item.optionName,
      totalQuantity: quantity,
      availableQuantity: quantity,
      lastArrivedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        chinaWarehouseInventory.userId,
        chinaWarehouseInventory.sku,
        chinaWarehouseInventory.optionKey,
      ],
      set: {
        productName: item.productName,
        optionName: item.optionName,
        totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} + ${quantity}`,
        availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} + ${quantity}`,
        lastArrivedAt: new Date(),
        updatedAt: new Date(),
      },
    })

  const [inventoryRow] = await tx
    .select()
    .from(chinaWarehouseInventory)
    .where(and(
      eq(chinaWarehouseInventory.userId, item.userId),
      eq(chinaWarehouseInventory.sku, item.sku),
      eq(chinaWarehouseInventory.optionKey, optionKey),
    ))
    .limit(1)

  if (!inventoryRow) throw new Error('중국창고 재고 반영에 실패했습니다.')

  await tx.insert(chinaWarehouseInventoryMovements).values({
    inventoryId: inventoryRow.id,
    userId: item.userId,
    purchaseRequestItemId: item.id,
    movementType: 'arrival',
    delta: quantity,
    quantityBefore: inventoryRow.totalQuantity - quantity,
    quantityAfter: inventoryRow.totalQuantity,
    note: '중국창고도착 상태 이동',
  }).onConflictDoNothing()
}

async function subtractChinaWarehouseStock(tx: DbTransaction, item: PurchaseRequestItem) {
  const quantity = outboundQuantity(item)
  if (quantity <= 0) return
  const optionKey = item.optionName ?? ''

  if (await hasChinaWarehouseMovement(tx, item.id, 'outbound_request')) return
  if (!await hasChinaWarehouseMovement(tx, item.id, 'arrival')) {
    return
  }

  const [inventoryRow] = await tx
    .select()
    .from(chinaWarehouseInventory)
    .where(and(
      eq(chinaWarehouseInventory.userId, item.userId),
      eq(chinaWarehouseInventory.sku, item.sku),
      eq(chinaWarehouseInventory.optionKey, optionKey),
    ))
    .limit(1)

  if (!inventoryRow) return
  if (inventoryRow.availableQuantity < quantity) {
    return
  }

  await tx
    .update(chinaWarehouseInventory)
    .set({
      totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} - ${quantity}`,
      availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} - ${quantity}`,
      lastOutboundRequestedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(chinaWarehouseInventory.id, inventoryRow.id))

  await tx.insert(chinaWarehouseInventoryMovements).values({
    inventoryId: inventoryRow.id,
    userId: item.userId,
    purchaseRequestItemId: item.id,
    movementType: 'outbound_request',
    delta: -quantity,
    quantityBefore: inventoryRow.totalQuantity,
    quantityAfter: inventoryRow.totalQuantity - quantity,
    note: '출고요청 상태 이동',
  }).onConflictDoNothing()

  await deleteEmptyChinaWarehouseInventory(tx, item.userId)
}

async function adjustChinaWarehouseArrivalQuantity(
  tx: DbTransaction,
  item: PurchaseRequestItem,
  nextQuantity: number,
) {
  const [movement] = await tx
    .select()
    .from(chinaWarehouseInventoryMovements)
    .where(and(
      eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, item.id),
      eq(chinaWarehouseInventoryMovements.movementType, 'arrival'),
    ))
    .limit(1)

  if (!movement) return
  const difference = nextQuantity - movement.delta
  if (difference === 0) return
  if (difference < 0) {
    const [inventoryRow] = await tx
      .select({ availableQuantity: chinaWarehouseInventory.availableQuantity })
      .from(chinaWarehouseInventory)
      .where(eq(chinaWarehouseInventory.id, movement.inventoryId))
      .limit(1)
    if (!inventoryRow || inventoryRow.availableQuantity < Math.abs(difference)) {
      throw new Error('이미 출고요청된 수량보다 중국도착수량을 적게 줄일 수 없습니다.')
    }
  }

  await tx
    .update(chinaWarehouseInventory)
    .set({
      totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} + ${difference}`,
      availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} + ${difference}`,
      updatedAt: new Date(),
    })
    .where(eq(chinaWarehouseInventory.id, movement.inventoryId))

  await tx
    .update(chinaWarehouseInventoryMovements)
    .set({
      delta: nextQuantity,
      quantityAfter: movement.quantityBefore + nextQuantity,
    })
    .where(eq(chinaWarehouseInventoryMovements.id, movement.id))

  await deleteEmptyChinaWarehouseInventory(tx, item.userId)
}

async function adjustChinaWarehouseOutboundQuantity(
  tx: DbTransaction,
  item: PurchaseRequestItem,
  nextQuantity: number,
) {
  const [movement] = await tx
    .select()
    .from(chinaWarehouseInventoryMovements)
    .where(and(
      eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, item.id),
      eq(chinaWarehouseInventoryMovements.movementType, 'outbound_request'),
    ))
    .limit(1)

  if (!movement) return
  const currentQuantity = Math.abs(movement.delta)
  const difference = nextQuantity - currentQuantity
  if (difference === 0) return

  const [inventoryRow] = await tx
    .select({ availableQuantity: chinaWarehouseInventory.availableQuantity })
    .from(chinaWarehouseInventory)
    .where(eq(chinaWarehouseInventory.id, movement.inventoryId))
    .limit(1)
  if (!inventoryRow) throw new Error('중국창고 재고를 찾을 수 없습니다.')
  if (difference > 0 && inventoryRow.availableQuantity < difference) {
    throw new Error(`중국창고 재고가 부족합니다. 현재 ${inventoryRow.availableQuantity}개, 추가 출고요청 ${difference}개`)
  }

  await tx
    .update(chinaWarehouseInventory)
    .set({
      totalQuantity: sql`${chinaWarehouseInventory.totalQuantity} - ${difference}`,
      availableQuantity: sql`${chinaWarehouseInventory.availableQuantity} - ${difference}`,
      updatedAt: new Date(),
    })
    .where(eq(chinaWarehouseInventory.id, movement.inventoryId))

  await tx
    .update(chinaWarehouseInventoryMovements)
    .set({
      delta: -nextQuantity,
      quantityAfter: movement.quantityBefore - nextQuantity,
    })
    .where(eq(chinaWarehouseInventoryMovements.id, movement.id))

  await deleteEmptyChinaWarehouseInventory(tx, item.userId)
}

async function hasChinaWarehouseMovement(
  tx: DbTransaction,
  purchaseRequestItemId: string,
  movementType: 'arrival' | 'outbound_request',
) {
  const [existingMovement] = await tx
    .select({ id: chinaWarehouseInventoryMovements.id })
    .from(chinaWarehouseInventoryMovements)
    .where(and(
      eq(chinaWarehouseInventoryMovements.purchaseRequestItemId, purchaseRequestItemId),
      eq(chinaWarehouseInventoryMovements.movementType, movementType),
    ))
    .limit(1)

  return Boolean(existingMovement)
}

async function deleteEmptyChinaWarehouseInventory(tx: DbTransaction, userId: string) {
  await tx
    .delete(chinaWarehouseInventory)
    .where(and(
      eq(chinaWarehouseInventory.userId, userId),
      eq(chinaWarehouseInventory.totalQuantity, 0),
      eq(chinaWarehouseInventory.availableQuantity, 0),
    ))
}

function purchaseQuantity(item: PurchaseRequestItem) {
  return item.chinaReceivedQuantity ?? item.actualPurchaseQuantity ?? item.requestedQuantity ?? 0
}

function outboundQuantity(item: PurchaseRequestItem) {
  return getOutboundRequestedQuantity({
    rawData: item.rawData,
    chinaReceivedQuantity: item.chinaReceivedQuantity,
    actualPurchaseQuantity: item.actualPurchaseQuantity,
    requestedQuantity: item.requestedQuantity,
  })
}

const PURCHASE_BUYERS: Record<string, string> = {
  '1': '한상철',
  '2': '김기환',
  '3': '최종석',
  '4': '오지은',
  '5': '김소희',
}

async function nextPurchaseManagementAssignment(tx: DbTransaction, item: PurchaseRequestItem) {
  const dateKey = formatSeoulDateKey(new Date())
  const buyerCode = normalizePurchaseBuyerCode(item.buyerCode ?? item.managerCode)
  const buyerName = PURCHASE_BUYERS[buyerCode]
  const prefix = `${dateKey}-${buyerCode}-`
  const rows = await tx
    .select({
      sequence: purchaseRequestItems.sequence,
      purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
    })
    .from(purchaseRequestItems)
    .where(and(
      eq(purchaseRequestItems.userId, item.userId),
      ilike(purchaseRequestItems.purchaseManagementCode, `${prefix}%`),
    ))

  const sequence = rows.reduce((maxSequence, row) => {
    const suffix = row.purchaseManagementCode?.slice(prefix.length)
    const codeSequence = suffix && /^\d+$/.test(suffix) ? Number(suffix) : 0
    return Math.max(maxSequence, row.sequence ?? 0, codeSequence)
  }, 0) + 1
  return {
    buyerCode,
    buyerName,
    sequence,
    purchaseManagementCode: `${prefix}${sequence}`,
  }
}

function normalizePurchaseBuyerCode(value: string | null | undefined) {
  const code = value?.trim()
  return code && PURCHASE_BUYERS[code] ? code : '4'
}

function formatSeoulDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '00'
  const day = parts.find((part) => part.type === 'day')?.value ?? '00'
  return `${year}${month}${day}`
}

function todayKstDate() {
  const key = formatSeoulDateKey(new Date())
  return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

