import { and, asc, count, desc, eq, getTableColumns, gt, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  chinaWarehouseInventory,
  chinaWarehouseInventoryMovements,
  inventory,
  products,
  purchaseRequestItems,
  saasChinaPurchaseLinks,
} from '@/lib/db/schema'
import {
  calculateAppliedPurchaseExchangeRateKrw,
  calculatePurchaseCosts,
  sumPurchaseCosts,
} from './purchase-costs'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import {
  PURCHASE_DELAY_REASONS,
  PURCHASE_DELAY_TRACKING_START_DATE,
  purchaseDelayReasonToItemStatus,
  type PurchaseDelayReason,
} from './purchase-delay'
import { getSkuOutgoingMetrics, PURCHASE_URL_HEADER } from './items'
import { purchasePipelineQuantity } from './purchase-recommendations'
import {
  getProductGroupPurchaseUrgencyStatus,
  getUrgentPurchaseProductNames,
  type PurchaseUrgencyStatus,
} from './purchase-urgency'
import {
  type PurchasePaymentStatus,
  type PurchaseRequestStatus,
} from './purchase-request-status'
import { ensurePurchasePaymentTrackingSchema } from './purchase-payment-tracking'
import {
  ensurePurchaseFundLedgerSchema,
  reconcilePurchaseFundDebitsInTransaction,
} from './purchase-fund-ledger'
import {
  ensureIgnoredPurchasingItemsTable,
  ignorePurchasingItemsInTransaction,
  purchasingItemIdentity,
  purchasingItemOrderIdentity,
  purchasingOutboundComponentIdentity,
} from './ignored-purchasing-items'
import { isUniqueSupplierOrderIdentifier } from './supplier-order-reference'
import {
  adjustSaasChinaPurchaseArrivalQuantityInTransaction,
  ensureSaasChinaOutboundSchema,
  hasSaasChinaPurchaseLinkInTransaction,
  receiveSaasChinaPurchaseArrivalInTransaction,
} from './saas-china-outbound'

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

const PAYMENT_FLOW_MANUALLY_COMPLETED_SOURCE = 'payment_flow_manually_completed'

export type PurchaseCostSummary = {
  itemCount: number
  totalCostYuan: number
  totalCostKrw: number
  missingYuanCostCount: number
  missingKrwCostCount: number
}

export type PurchaseReviewHistory = {
  lastPurchaseDate: string
  lastPurchaseQuantity: number
  threeMonthAverageOutgoingAtLastPurchase: number
}

export type PurchaseReviewHistoryCandidate = {
  sku: string
  requestedQuantity: number
  actualPurchaseQuantity: number | null
  requestDate: string | null
  outboundExpectedDate: string | null
  rawData: Record<string, unknown>
  createdAt: Date
}

export type PurchaseReviewOperationalMetrics = {
  lastPurchaseDate: string | null
  lastPurchaseQuantity: number | null
  lastPurchaseThreeMonthAverageOutgoing: number | null
  purchaseInProgressQuantity: number
  chinaOutboundScheduledQuantity: number
  domesticCurrentStock: number
  chinaCurrentStock: number
  currentStock: number
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
  targetStockQuantity: number
}

export type PurchaseReviewPipelineQuantities = Pick<
  PurchaseReviewOperationalMetrics,
  'purchaseInProgressQuantity' | 'chinaOutboundScheduledQuantity'
>

export const PURCHASE_REVIEW_LIST_STATUSES = ['review', 'not_required'] as const

export type PurchaseReviewListStatus = (typeof PURCHASE_REVIEW_LIST_STATUSES)[number]

export const PURCHASE_REVIEW_LIST_STATUS_LABELS: Record<PurchaseReviewListStatus, string> = {
  review: '발주검토',
  not_required: '발주불필요',
}

export type PurchaseReviewListItem = {
  id: string | null
  reviewStatus: PurchaseReviewListStatus
  status: 'requested'
  sku: string
  productName: string
  optionName: string | null
  requestedQuantity: number
  actualPurchaseQuantity: number | null
  chinaReceivedQuantity: number | null
  rawData: Record<string, unknown>
  requestDate: string | null
  outboundExpectedDate: string | null
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
  trackingNumber: string | null
  purchaseMethod: string | null
  paymentStatus: PurchasePaymentStatus
  paymentPaidAt: Date | null
  bulkPaymentPending: boolean
  bulkPaymentDueDate: string | null
  delayReason: PurchaseDelayReason | null
  delayNote: string | null
  memo: string | null
  buyerCode: string | null
  buyerName: string | null
  managerCode: string | null
  purchaseUrl: string | null
  purchasingStatus: string | null
  purchasingStatusNote: string | null
  chinaCurrentStock: number
  costExchangeRateKrw: string | null
  specialPriceCny: string | null
  newCostCny: string | null
  unitCostYuan: number | null
  unitCostKrw: number | null
  totalCostYuan: number | null
  totalCostKrw: number | null
  purchaseReviewMetrics: PurchaseReviewOperationalMetrics | null
  purchaseReviewHistory: PurchaseReviewHistory | null
  purchaseUrgencyStatus: PurchaseUrgencyStatus | null
}

type PurchaseReviewListBaseItem = Omit<
  PurchaseReviewListItem,
  'purchaseReviewMetrics' | 'purchaseReviewHistory' | 'purchaseUrgencyStatus'
> & {
  metadata: Record<string, unknown> | null
}

export type PurchaseReviewPipelineRow = {
  sku: string
  status: PurchaseRequestStatus | string
  requestedQuantity: number
  actualPurchaseQuantity: number | null
  chinaReceivedQuantity: number | null
  rawData: Record<string, unknown>
}

export type PurchasePaymentFlowSummary = {
  total: PurchaseCostSummary
  purchaseBefore: PurchaseCostSummary
  purchaseCompleted: PurchaseCostSummary
  chinaArrived: PurchaseCostSummary
  outboundRequested: PurchaseCostSummary
  orderNumberRegistered: PurchaseCostSummary
  outstanding: PurchaseCostSummary
  bulkPending: PurchaseCostSummary
}

export const PURCHASE_PAYMENT_FLOW_VIEWS = [
  'total',
  // Kept for existing payment-flow URLs. This is the operational `purchased`
  // status, not a supplier-order-number bucket.
  'purchase_before',
  'purchase_completed',
  'china_arrived',
  'outbound_requested',
  'order_number_registered',
  'outstanding',
  'bulk_pending',
] as const

export type PurchasePaymentFlowView = (typeof PURCHASE_PAYMENT_FLOW_VIEWS)[number]

export const PURCHASE_PAYMENT_FLOW_SORTS = [
  'productName',
  'quantity',
  'unitCostYuan',
  'unitCostKrw',
  'supplierOrderNumber',
  'totalCostYuan',
  'totalCostKrw',
] as const
export type PurchasePaymentFlowSort = (typeof PURCHASE_PAYMENT_FLOW_SORTS)[number]

export const PURCHASE_PAYMENT_FLOW_VIEW_LABELS: Record<PurchasePaymentFlowView, string> = {
  total: '발주금액 총액',
  purchase_before: '발주요청',
  purchase_completed: '구매완료',
  china_arrived: '중국창고도착',
  outbound_requested: '중국출고요청',
  order_number_registered: '주문서번호 등록',
  outstanding: '일반 결제대기',
  bulk_pending: '대량결제 잔금',
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
  bulkPaymentPending: boolean
  bulkPaymentDueDate: string | null
  bulkPaymentDepositCny: number
  bulkPaymentDepositKrw: number
  bulkPaymentDepositPaidAt: string | null
  bulkPaymentDepositMemo: string | null
  bulkPaymentRemainingCny: number | null
  bulkPaymentRemainingKrw: number | null
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
      paymentStatus: purchaseRequestItems.paymentStatus,
      bulkPaymentPending: purchaseRequestItems.bulkPaymentPending,
      itemCount: count(),
      totalCostYuan: sql<number>`COALESCE(SUM(COALESCE(${costs.totalCostYuan}, 0)), 0)`,
      totalCostKrw: sql<number>`COALESCE(SUM(COALESCE(${costs.totalCostKrw}, 0)), 0)`,
      missingYuanCostCount: sql<number>`COUNT(*) FILTER (WHERE ${costs.totalCostYuan} IS NULL)`,
      missingKrwCostCount: sql<number>`COUNT(*) FILTER (WHERE ${costs.totalCostKrw} IS NULL)`,
      bulkRemainingCostYuan: sql<number>`COALESCE(SUM(
        CASE WHEN ${purchaseRequestItems.bulkPaymentPending} IS TRUE
          THEN GREATEST(COALESCE(${costs.totalCostYuan}, 0) - COALESCE(${purchaseRequestItems.bulkPaymentDepositCny}, 0), 0)
          ELSE 0
        END
      ), 0)`,
      bulkRemainingCostKrw: sql<number>`COALESCE(SUM(
        CASE WHEN ${purchaseRequestItems.bulkPaymentPending} IS TRUE
          THEN GREATEST(COALESCE(${costs.totalCostKrw}, 0) - COALESCE(${purchaseRequestItems.bulkPaymentDepositKrw}, 0), 0)
          ELSE 0
        END
      ), 0)`,
      bulkMissingYuanCostCount: sql<number>`COUNT(*) FILTER (
        WHERE ${purchaseRequestItems.bulkPaymentPending} IS TRUE
          AND ${costs.totalCostYuan} IS NULL
      )`,
      bulkMissingKrwCostCount: sql<number>`COUNT(*) FILTER (
        WHERE ${purchaseRequestItems.bulkPaymentPending} IS TRUE
          AND ${costs.totalCostKrw} IS NULL
      )`,
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
    .groupBy(
      purchaseRequestItems.status,
      hasSupplierOrderNumber,
      purchaseRequestItems.paymentStatus,
      purchaseRequestItems.bulkPaymentPending,
    )

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
      bulkPaymentPending: purchaseRequestItems.bulkPaymentPending,
      bulkPaymentDueDate: purchaseRequestItems.bulkPaymentDueDate,
      bulkPaymentDepositCny: purchaseRequestItems.bulkPaymentDepositCny,
      bulkPaymentDepositKrw: purchaseRequestItems.bulkPaymentDepositKrw,
      bulkPaymentDepositPaidAt: purchaseRequestItems.bulkPaymentDepositPaidAt,
      bulkPaymentDepositMemo: purchaseRequestItems.bulkPaymentDepositMemo,
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

  const items = rows.map((row) => toPurchasePaymentFlowDetailItem(row, fallbackExchangeRateKrw))
  const summary = summarizePurchasePaymentFlowItems(items)

  return {
    summary: {
      total: summary.total,
      purchaseBefore: summary.purchase_before,
      purchaseCompleted: summary.purchase_completed,
      chinaArrived: summary.china_arrived,
      outboundRequested: summary.outbound_requested,
      orderNumberRegistered: summary.order_number_registered,
      outstanding: summary.outstanding,
      bulkPending: summary.bulk_pending,
    },
    items,
  }
}

export async function getPurchasePaymentFlowDetailPage(input: {
  userId: string
  fallbackExchangeRateKrw: number
  view: PurchasePaymentFlowView
  search?: string
  page: number
  pageSize: number
  sort: PurchasePaymentFlowSort | null | undefined
  order: 'asc' | 'desc'
}): Promise<PurchasePaymentFlowDetailPage> {
  await ensurePurchasePaymentTrackingSchema()
  const page = positiveIntegerOr(input.page, 1)
  const pageSize = Math.min(200, positiveIntegerOr(input.pageSize, 50))
  const where = paymentFlowDetailWhere(input.userId, input.view, input.search)
  const orderBy = paymentFlowDetailOrderBy(input.sort, input.order, input.fallbackExchangeRateKrw)

  const rows = await db
    .select({
      id: purchaseRequestItems.id,
      status: purchaseRequestItems.status,
      paymentStatus: purchaseRequestItems.paymentStatus,
      paymentPaidAt: purchaseRequestItems.paymentPaidAt,
      bulkPaymentPending: purchaseRequestItems.bulkPaymentPending,
      bulkPaymentDueDate: purchaseRequestItems.bulkPaymentDueDate,
      bulkPaymentDepositCny: purchaseRequestItems.bulkPaymentDepositCny,
      bulkPaymentDepositKrw: purchaseRequestItems.bulkPaymentDepositKrw,
      bulkPaymentDepositPaidAt: purchaseRequestItems.bulkPaymentDepositPaidAt,
      bulkPaymentDepositMemo: purchaseRequestItems.bulkPaymentDepositMemo,
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
    items: rows.map((row) => toPurchasePaymentFlowDetailItem(row, input.fallbackExchangeRateKrw)),
  }
}

export async function getPurchasePaymentFlowDetailCount(input: {
  userId: string
  view: PurchasePaymentFlowView
  search: string
}): Promise<number> {
  await ensurePurchasePaymentTrackingSchema()
  const [row] = await db
    .select({ itemCount: count() })
    .from(purchaseRequestItems)
    .where(paymentFlowDetailWhere(input.userId, input.view, input.search))

  return Number(row?.itemCount ?? 0)
}

export function isPurchasePaymentFlowViewItem(
  item: {
    status: PurchaseRequestStatus
    supplierOrderNumber?: string | null
    hasSupplierOrderNumber?: boolean
    paymentStatus?: string | null
    bulkPaymentPending?: boolean
  },
  view: PurchasePaymentFlowView,
) {
  const hasSupplierOrderNumber = item.hasSupplierOrderNumber
    ?? Boolean(item.supplierOrderNumber?.trim())

  if (view === 'total') return true
  if (view === 'purchase_before') return item.status === 'purchased'
  if (view === 'purchase_completed') return item.status === 'purchase_completed'
  if (view === 'china_arrived') return item.status === 'china_arrived'
  if (view === 'outbound_requested') return item.status === 'outbound_requested'
  if (view === 'order_number_registered') return hasSupplierOrderNumber
  const isPaid = item.paymentStatus === 'paid'
  if (view === 'bulk_pending') return item.bulkPaymentPending === true && !isPaid
  return !hasSupplierOrderNumber && item.bulkPaymentPending !== true && !isPaid
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
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      if (sort) {
        const sortDifference = comparePurchasePaymentFlowSortValues(
          purchasePaymentFlowSortValue(left.item, sort),
          purchasePaymentFlowSortValue(right.item, sort),
          order,
        )
        if (sortDifference !== 0) return sortDifference
      }

      const purchaseDateDifference = comparePurchasePaymentFlowSortValues(
        purchasePaymentFlowPurchaseDate(left.item),
        purchasePaymentFlowPurchaseDate(right.item),
        'desc',
      )
      if (purchaseDateDifference !== 0) return purchaseDateDifference

      const productDifference = comparePurchasePaymentFlowSortValues(
        left.item.productName,
        right.item.productName,
        'asc',
      )
      if (productDifference !== 0) return productDifference

      const skuDifference = comparePurchasePaymentFlowSortValues(left.item.sku, right.item.sku, 'asc')
      if (skuDifference !== 0) return skuDifference

      const optionDifference = comparePurchasePaymentFlowSortValues(left.item.optionName, right.item.optionName, 'asc')
      return optionDifference === 0 ? left.index - right.index : optionDifference
    })
    .map(({ item }) => item)
}

function purchasePaymentFlowSortValue(
  item: PurchasePaymentFlowDetailItem,
  sort: PurchasePaymentFlowSort,
) {
  switch (sort) {
    case 'productName':
      return item.productName
    case 'quantity':
      return item.quantity
    case 'unitCostYuan':
      return item.unitCostYuan
    case 'unitCostKrw':
      return item.unitCostKrw
    case 'supplierOrderNumber':
      return item.supplierOrderNumber
    case 'totalCostYuan':
      return item.totalCostYuan
    case 'totalCostKrw':
      return item.totalCostKrw
  }
}

function purchasePaymentFlowPurchaseDate(item: PurchasePaymentFlowDetailItem) {
  return item.outboundExpectedDate ?? item.requestDate
}

function comparePurchasePaymentFlowSortValues(
  left: string | number | null,
  right: string | number | null,
  order: 'asc' | 'desc',
) {
  const leftMissing = left === null || left === ''
  const rightMissing = right === null || right === ''
  if (leftMissing) return rightMissing ? 0 : 1
  if (rightMissing) return -1

  const direction = order === 'asc' ? 1 : -1
  if (typeof left === 'number' && typeof right === 'number') {
    return (left - right) * direction
  }

  return String(left).localeCompare(String(right), 'ko-KR') * direction
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
    case 'china_arrived':
      return summary.chinaArrived
    case 'outbound_requested':
      return summary.outboundRequested
    case 'order_number_registered':
      return summary.orderNumberRegistered
    case 'outstanding':
      return summary.outstanding
    case 'bulk_pending':
      return summary.bulkPending
    default:
      return summary.total
  }
}

type PurchasePaymentFlowSummaryGroup = {
  status: PurchaseRequestStatus
  hasSupplierOrderNumber: boolean
  paymentStatus: string | null
  bulkPaymentPending: boolean
  itemCount: number | string
  totalCostYuan: number | string
  totalCostKrw: number | string
  missingYuanCostCount: number | string
  missingKrwCostCount: number | string
  bulkRemainingCostYuan: number | string
  bulkRemainingCostKrw: number | string
  bulkMissingYuanCostCount: number | string
  bulkMissingKrwCostCount: number | string
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
    const bulkBalanceSummary = {
      itemCount: wholeNumber(row.itemCount),
      totalCostYuan: finiteNumber(row.bulkRemainingCostYuan),
      totalCostKrw: finiteNumber(row.bulkRemainingCostKrw),
      missingYuanCostCount: wholeNumber(row.bulkMissingYuanCostCount),
      missingKrwCostCount: wholeNumber(row.bulkMissingKrwCostCount),
    }

    for (const view of PURCHASE_PAYMENT_FLOW_VIEWS) {
      if (!isPurchasePaymentFlowViewItem(row, view)) continue
      addPurchaseCostSummary(summaries[view], view === 'bulk_pending' ? bulkBalanceSummary : groupSummary)
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
    chinaArrived: summaries.china_arrived,
    outboundRequested: summaries.outbound_requested,
    orderNumberRegistered: summaries.order_number_registered,
    outstanding: summaries.outstanding,
    bulkPending: summaries.bulk_pending,
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

function paymentFlowDetailWhere(userId: string, view: PurchasePaymentFlowView, search?: string): SQL {
  const conditions: SQL[] = [
    eq(purchaseRequestItems.userId, userId),
    inArray(purchaseRequestItems.status, [...ACTIVE_PURCHASE_PAYMENT_STATUSES]),
  ]
  const hasSupplierOrderNumber = hasSupplierOrderNumberSql()

  if (view === 'purchase_before') {
    conditions.push(eq(purchaseRequestItems.status, 'purchased'))
  } else if (view === 'purchase_completed') {
    conditions.push(eq(purchaseRequestItems.status, 'purchase_completed'))
  } else if (view === 'china_arrived') {
    conditions.push(eq(purchaseRequestItems.status, 'china_arrived'))
  } else if (view === 'outbound_requested') {
    conditions.push(eq(purchaseRequestItems.status, 'outbound_requested'))
  } else if (view === 'order_number_registered') {
    conditions.push(hasSupplierOrderNumber)
  } else if (view === 'outstanding') {
    conditions.push(sql`NOT (${hasSupplierOrderNumber})`)
    conditions.push(sql`${purchaseRequestItems.bulkPaymentPending} IS NOT TRUE`)
    conditions.push(sql`COALESCE(${purchaseRequestItems.paymentStatus}, 'pending') <> 'paid'`)
  } else if (view === 'bulk_pending') {
    conditions.push(eq(purchaseRequestItems.bulkPaymentPending, true))
    conditions.push(sql`COALESCE(${purchaseRequestItems.paymentStatus}, 'pending') <> 'paid'`)
  }

  if (search?.trim()) {
    const pattern = `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`
    conditions.push(or(
      ilike(purchaseRequestItems.sku, pattern),
      ilike(purchaseRequestItems.productName, pattern),
      ilike(purchaseRequestItems.optionName, pattern),
      ilike(purchaseRequestItems.purchaseManagementCode, pattern),
      ilike(purchaseRequestItems.supplierOrderNumber, pattern),
    )!)
  }

  return and(...conditions) ?? sql`TRUE`
}

function paymentFlowDetailOrderBy(
  sort: PurchasePaymentFlowSort | null | undefined,
  order: 'asc' | 'desc',
  fallbackExchangeRateKrw: number,
): SQL[] {
  const groupedOrder = paymentFlowGroupedOrderBy()
  if (!sort) return groupedOrder

  const costs = purchasePaymentFlowCostSqlExpressions(fallbackExchangeRateKrw)
  const sortExpression = (() => {
    switch (sort) {
      case 'productName':
        return purchaseRequestItems.productName
      case 'quantity':
        return costs.quantity
      case 'unitCostYuan':
        return costs.unitCostYuan
      case 'unitCostKrw':
        return costs.unitCostKrw
      case 'supplierOrderNumber':
        return normalizedSupplierOrderNumberSql()
      case 'totalCostYuan':
        return costs.totalCostYuan
      case 'totalCostKrw':
        return costs.totalCostKrw
    }
  })()

  const primaryOrder = order === 'asc'
    ? sql`${sortExpression} ASC NULLS LAST`
    : sql`${sortExpression} DESC NULLS LAST`

  return [primaryOrder, ...groupedOrder]
}

function paymentFlowGroupedOrderBy(): SQL[] {
  return [
    sql`${paymentFlowPurchaseDateSql()} DESC NULLS LAST`,
    asc(purchaseRequestItems.productName),
    asc(purchaseRequestItems.sku),
    asc(purchaseRequestItems.optionName),
    asc(purchaseRequestItems.id),
  ]
}

function paymentFlowPurchaseDateSql() {
  return sql<string>`COALESCE(${purchaseRequestItems.outboundExpectedDate}, ${purchaseRequestItems.requestDate})`
}

function hasSupplierOrderNumberSql() {
  return sql<boolean>`${normalizedSupplierOrderNumberSql()} IS NOT NULL`
}

function normalizedSupplierOrderNumberSql() {
  return sql<string | null>`NULLIF(BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')), '')`
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
    quantity,
    unitCostYuan,
    unitCostKrw: sql<number>`CASE
      WHEN ${unitCostYuan} IS NULL OR ${appliedExchangeRateKrw} IS NULL THEN NULL
      ELSE ROUND(${unitCostYuan} * ${appliedExchangeRateKrw})
    END`,
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

type PurchasePaymentFlowSourceRow = PurchaseCostRow & {
  id: string
  paymentStatus: string | null
  paymentPaidAt: Date | null
  bulkPaymentPending: boolean
  bulkPaymentDueDate: string | null
  bulkPaymentDepositCny: string | number | null
  bulkPaymentDepositKrw: string | number | null
  bulkPaymentDepositPaidAt: string | null
  bulkPaymentDepositMemo: string | null
  sku: string
  productName: string
  optionName: string | null
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
  requestDate: string | null
  outboundExpectedDate: string | null
}

function toPurchasePaymentFlowDetailItem(
  row: PurchasePaymentFlowSourceRow,
  fallbackExchangeRateKrw: number,
): PurchasePaymentFlowDetailItem {
  const costs = calculatePurchaseCost(row, fallbackExchangeRateKrw)
  const paymentBalance = calculateBulkPaymentBalance({
    totalCostYuan: costs.totalCostYuan,
    totalCostKrw: costs.totalCostKrw,
    bulkPaymentDepositCny: row.bulkPaymentDepositCny,
    bulkPaymentDepositKrw: row.bulkPaymentDepositKrw,
  })

  return {
    id: row.id,
    status: row.status,
    paymentStatus: normalizePaymentStatus(row.paymentStatus),
    paymentPaidAt: row.paymentPaidAt,
    bulkPaymentPending: row.bulkPaymentPending,
    bulkPaymentDueDate: row.bulkPaymentDueDate,
    bulkPaymentDepositCny: paymentBalance.depositCny,
    bulkPaymentDepositKrw: paymentBalance.depositKrw,
    bulkPaymentDepositPaidAt: row.bulkPaymentDepositPaidAt,
    bulkPaymentDepositMemo: row.bulkPaymentDepositMemo,
    bulkPaymentRemainingCny: paymentBalance.remainingCny,
    bulkPaymentRemainingKrw: paymentBalance.remainingKrw,
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
}

export function calculateBulkPaymentBalance(input: {
  totalCostYuan: number | null
  totalCostKrw: number | null
  bulkPaymentDepositCny: string | number | null | undefined
  bulkPaymentDepositKrw: string | number | null | undefined
}) {
  const depositCny = nonNegativeMoney(input.bulkPaymentDepositCny)
  const depositKrw = nonNegativeMoney(input.bulkPaymentDepositKrw)

  return {
    depositCny,
    depositKrw,
    remainingCny: input.totalCostYuan === null
      ? null
      : roundMoney(Math.max(0, input.totalCostYuan - depositCny)),
    remainingKrw: input.totalCostKrw === null
      ? null
      : Math.round(Math.max(0, input.totalCostKrw - depositKrw)),
  }
}

function summarizePurchasePaymentFlowItems(items: PurchasePaymentFlowDetailItem[]) {
  const summaries = Object.fromEntries(
    PURCHASE_PAYMENT_FLOW_VIEWS.map((view) => [view, emptyPurchaseCostSummary()]),
  ) as Record<PurchasePaymentFlowView, PurchaseCostSummary>

  for (const item of items) {
    for (const view of PURCHASE_PAYMENT_FLOW_VIEWS) {
      if (!isPurchasePaymentFlowViewItem(item, view)) continue
      const isBulkBalance = view === 'bulk_pending'
      addPurchaseCostSummary(summaries[view], {
        itemCount: 1,
        totalCostYuan: isBulkBalance ? (item.bulkPaymentRemainingCny ?? 0) : (item.totalCostYuan ?? 0),
        totalCostKrw: isBulkBalance ? (item.bulkPaymentRemainingKrw ?? 0) : (item.totalCostKrw ?? 0),
        missingYuanCostCount: (isBulkBalance ? item.bulkPaymentRemainingCny : item.totalCostYuan) === null ? 1 : 0,
        missingKrwCostCount: (isBulkBalance ? item.bulkPaymentRemainingKrw : item.totalCostKrw) === null ? 1 : 0,
      })
    }
  }

  for (const summary of Object.values(summaries)) {
    summary.totalCostYuan = roundMoney(summary.totalCostYuan)
    summary.totalCostKrw = Math.round(summary.totalCostKrw)
  }

  return summaries
}

function purchaseCostQuantity(item: Pick<PurchaseCostRow, 'requestedQuantity' | 'actualPurchaseQuantity'>) {
  return item.actualPurchaseQuantity ?? item.requestedQuantity
}

function nonNegativeMoney(value: string | number | null | undefined) {
  const number = Number(typeof value === 'string' ? value.replace(/,/g, '') : value ?? 0)
  return Number.isFinite(number) && number > 0 ? roundMoney(number) : 0
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function normalizePaymentStatus(value: string | null | undefined): PurchasePaymentStatus {
  if (value === 'paid' || value === 'before_outbound') return value
  return 'pending'
}

function normalizePurchaseDelayReason(value: string | null | undefined): PurchaseDelayReason | null {
  return PURCHASE_DELAY_REASONS.includes(value as PurchaseDelayReason)
    ? value as PurchaseDelayReason
    : null
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
    SELECT COALESCE(SUM(${chinaWarehouseInventory.availableQuantity}), 0)::int
    FROM ${chinaWarehouseInventory}
    WHERE ${chinaWarehouseInventory.userId} = ${purchaseRequestItems.userId}
      AND ${chinaWarehouseInventory.sku} = ${purchaseRequestItems.sku}
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
  const purchaseReviewMetricsBySku = input.status === 'requested'
    ? await getPurchaseReviewOperationalMetricsBySku({
      userId: input.userId,
      skus: pricedItems.map((item) => item.sku),
    })
    : new Map<string, PurchaseReviewOperationalMetrics>()
  const urgentProductNames = getUrgentPurchaseProductNames(pricedItems)
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
    items: pricedItems.map((item) => ({
      ...item,
      reviewStatus: item.status === 'requested'
        ? item.requestedQuantity > 0 ? 'review' as const : 'not_required' as const
        : null,
      purchaseReviewMetrics: purchaseReviewMetricsBySku.get(item.sku) ?? null,
      purchaseReviewHistory: purchaseReviewHistoryFromMetrics(purchaseReviewMetricsBySku.get(item.sku)),
      purchaseUrgencyStatus: item.status === 'requested' || item.status === 'purchased'
        ? getProductGroupPurchaseUrgencyStatus({
          sku: item.sku,
          productName: item.productName,
          urgentProductNames,
        })
        : null,
    })),
    total,
    costTotals: summarizePurchaseCosts(costRows, input.exchangeRateKrw),
    missingCostItems,
    overduePurchasedCount: overduePurchaseCompletedCount,
    overduePurchaseRequestCount,
    overduePurchaseCompletedCount,
    overdueTotalCount: overduePurchaseRequestCount + overduePurchaseCompletedCount,
    statusCounts: Object.fromEntries(statusCounts.map((row) => [row.status, row.total])) as Partial<Record<PurchaseRequestStatus, number>>,
    reviewStatusCounts: {
      review: statusCounts.find((row) => row.status === 'requested')?.total ?? 0,
      not_required: 0,
    } satisfies Record<PurchaseReviewListStatus, number>,
  }
}

/**
 * Builds the purchase-review list from the item master instead of creating
 * zero-quantity purchase rows. This keeps the operational purchase workflow
 * unchanged while making every managed SKU visible for review and export.
 */
export async function getPurchaseReviewList(input: {
  userId: string
  search?: string
  statuses?: readonly PurchaseReviewListStatus[]
  page?: number
  pageSize?: number
  sort?: string
  order?: string
  exchangeRateKrw?: number
  targetStockMonths?: number
}) {
  await ensurePurchasePaymentTrackingSchema()
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 50
  const optionName = sql<string | null>`NULLIF(BTRIM(COALESCE(${products.metadata}->'esa009m'->>'규격정보', '')), '')`
  const normalizedSearch = input.search?.trim().toLocaleLowerCase('ko-KR') ?? ''
  const includeFullRawData = normalizedSearch.length > 0
  const [productRows, requestedRows] = await Promise.all([
    db.select({
      sku: products.internalSku,
      productName: products.name,
      optionName,
      // WORKS 원본 전체는 검색할 때만 필요하다. 기본 목록 조회에서는 수천 건의
      // 큰 JSON을 전송하지 않아 발주검토 첫 화면을 가볍게 유지한다.
      metadata: normalizedSearch
        ? products.metadata
        : sql<Record<string, unknown> | null>`NULL::jsonb`,
      specialPriceCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'특가(元)', '')`,
      newCostCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
      purchaseUrl: sql<string | null>`NULLIF(BTRIM(COALESCE(${products.metadata}->'esa009m'->>${PURCHASE_URL_HEADER}, '')), '')`,
      purchasingStatus: products.purchasingStatus,
      purchasingStatusNote: products.purchasingStatusNote,
    }).from(products).where(and(
      eq(products.userId, input.userId),
      sql`${products.metadata}->'esa009m' IS NOT NULL`,
    )).orderBy(asc(products.internalSku)),
    db.select({
      id: purchaseRequestItems.id,
      sku: purchaseRequestItems.sku,
      productName: purchaseRequestItems.productName,
      optionName: purchaseRequestItems.optionName,
      requestedQuantity: purchaseRequestItems.requestedQuantity,
      actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
      chinaReceivedQuantity: purchaseRequestItems.chinaReceivedQuantity,
      requestDate: purchaseRequestItems.requestDate,
      outboundExpectedDate: purchaseRequestItems.outboundExpectedDate,
      purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
      supplierOrderNumber: purchaseRequestItems.supplierOrderNumber,
      trackingNumber: purchaseRequestItems.trackingNumber,
      purchaseMethod: purchaseRequestItems.purchaseMethod,
      paymentStatus: purchaseRequestItems.paymentStatus,
      paymentPaidAt: purchaseRequestItems.paymentPaidAt,
      bulkPaymentPending: purchaseRequestItems.bulkPaymentPending,
      bulkPaymentDueDate: purchaseRequestItems.bulkPaymentDueDate,
      delayReason: purchaseRequestItems.delayReason,
      delayNote: purchaseRequestItems.delayNote,
      memo: purchaseRequestItems.memo,
      buyerCode: purchaseRequestItems.buyerCode,
      buyerName: purchaseRequestItems.buyerName,
      managerCode: purchaseRequestItems.managerCode,
      costExchangeRateKrw: purchaseRequestItems.costExchangeRateKrw,
      updatedAt: purchaseRequestItems.updatedAt,
      createdAt: purchaseRequestItems.createdAt,
      // Full raw source rows can be large. They are needed for a text search
      // and for the 10~200 visible rows, not for every review-row calculation.
      rawData: includeFullRawData
        ? purchaseRequestItems.rawData
        : sql<Record<string, unknown>>`'{}'::jsonb`,
      rawDataSource: sql<string | null>`NULLIF(${purchaseRequestItems.rawData}->>'source', '')`,
      rawStockCoverageMonths: sql<string | null>`NULLIF(${purchaseRequestItems.rawData}->>'stockCoverageMonths', '')`,
    }).from(purchaseRequestItems).where(and(
      eq(purchaseRequestItems.userId, input.userId),
      eq(purchaseRequestItems.status, 'requested'),
    )),
  ])

  const reviewRowBySku = latestPurchaseReviewRowBySku(requestedRows)
  const productSkus = new Set(productRows.map((product) => product.sku))
  const allProductRows = [
    ...productRows,
    ...requestedRows
      .filter((row) => !productSkus.has(row.sku))
      .map((row) => ({
        sku: row.sku,
        productName: row.productName,
        optionName: row.optionName,
        metadata: null,
        specialPriceCny: null,
        newCostCny: null,
        purchaseUrl: null,
        purchasingStatus: null,
        purchasingStatusNote: null,
      })),
  ]
  const baseRows: PurchaseReviewListBaseItem[] = allProductRows.map((product): PurchaseReviewListBaseItem => {
    const source = reviewRowBySku.get(product.sku)
    const requestedQuantity = Math.max(0, source?.requestedQuantity ?? 0)
    const costs = calculatePurchaseCosts({
      requestedQuantity,
      specialPriceCny: product.specialPriceCny,
      newCostCny: product.newCostCny,
      exchangeRateKrw: source?.costExchangeRateKrw ?? input.exchangeRateKrw,
    })
    return {
      id: requestedQuantity > 0 ? source?.id ?? null : null,
      reviewStatus: requestedQuantity > 0 ? 'review' as const : 'not_required' as const,
      status: 'requested' as const,
      sku: product.sku,
      productName: product.productName,
      optionName: product.optionName,
      requestedQuantity,
      actualPurchaseQuantity: source?.actualPurchaseQuantity ?? null,
      chinaReceivedQuantity: source?.chinaReceivedQuantity ?? null,
      rawData: includeFullRawData
        ? source?.rawData ?? {}
        : purchaseReviewRawDataSummary(source?.rawDataSource, source?.rawStockCoverageMonths),
      requestDate: source?.requestDate ?? null,
      outboundExpectedDate: source?.outboundExpectedDate ?? null,
      purchaseManagementCode: source?.purchaseManagementCode ?? null,
      supplierOrderNumber: source?.supplierOrderNumber ?? null,
      trackingNumber: source?.trackingNumber ?? null,
      purchaseMethod: source?.purchaseMethod ?? null,
      paymentStatus: normalizePaymentStatus(source?.paymentStatus),
      paymentPaidAt: source?.paymentPaidAt ?? null,
      bulkPaymentPending: source?.bulkPaymentPending ?? false,
      bulkPaymentDueDate: source?.bulkPaymentDueDate ?? null,
      delayReason: normalizePurchaseDelayReason(source?.delayReason),
      delayNote: source?.delayNote ?? null,
      memo: source?.memo ?? null,
      buyerCode: source?.buyerCode ?? null,
      buyerName: source?.buyerName ?? null,
      managerCode: source?.managerCode ?? null,
      purchaseUrl: product.purchaseUrl,
      purchasingStatus: product.purchasingStatus,
      purchasingStatusNote: product.purchasingStatusNote,
      chinaCurrentStock: 0,
      costExchangeRateKrw: source?.costExchangeRateKrw ?? null,
      specialPriceCny: product.specialPriceCny,
      newCostCny: product.newCostCny,
      ...costs,
      metadata: product.metadata,
    }
  })
  const requestedStatuses = normalizePurchaseReviewListStatuses(input.statuses)
  const filteredRows = baseRows.filter((row) => (
    requestedStatuses.includes(row.reviewStatus)
    && matchesPurchaseReviewSearch(row, normalizedSearch)
  ))
  const sortedRows = sortPurchaseReviewListRows(filteredRows, input.sort, input.order)
  const reviewRows = filteredRows.filter((row) => row.reviewStatus === 'review')
  const costRows = reviewRows.map((row) => ({
    status: row.status,
    requestedQuantity: row.requestedQuantity,
    actualPurchaseQuantity: row.actualPurchaseQuantity,
    specialPriceCny: row.specialPriceCny,
    newCostCny: row.newCostCny,
    costExchangeRateKrw: row.costExchangeRateKrw,
  }))
  const missingCostItems = reviewRows
    .map((row) => ({ row, costs: calculatePurchaseCosts({
      requestedQuantity: row.actualPurchaseQuantity ?? row.requestedQuantity,
      specialPriceCny: row.specialPriceCny,
      newCostCny: row.newCostCny,
      exchangeRateKrw: row.costExchangeRateKrw ?? input.exchangeRateKrw,
    }) }))
    .filter(({ costs }) => costs.unitCostYuan === null || costs.unitCostKrw === null)
    .map(({ row, costs }) => ({
      sku: row.sku,
      productName: row.productName,
      missingYuan: costs.unitCostYuan === null,
      missingKrw: costs.unitCostKrw === null,
    }))
  const total = sortedRows.length
  const pageRows = sortedRows.slice((page - 1) * pageSize, page * pageSize)
  const pageRequestIds = pageRows
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id))
  const [metricsBySku, pageRawDataRows] = await Promise.all([
    getPurchaseReviewOperationalMetricsBySku({
      userId: input.userId,
      skus: pageRows.map((row) => row.sku),
      targetStockMonths: input.targetStockMonths,
    }),
    includeFullRawData || pageRequestIds.length === 0
      ? Promise.resolve([])
      : db
        .select({
          id: purchaseRequestItems.id,
          rawData: purchaseRequestItems.rawData,
        })
        .from(purchaseRequestItems)
        .where(and(
          eq(purchaseRequestItems.userId, input.userId),
          inArray(purchaseRequestItems.id, pageRequestIds),
        )),
  ])
  const pageRawDataById = new Map(pageRawDataRows.map((row) => [row.id, row.rawData]))
  const urgentProductNames = getUrgentPurchaseProductNames(baseRows)
  const items: PurchaseReviewListItem[] = pageRows.map((row) => {
    const metrics = metricsBySku.get(row.sku) ?? emptyPurchaseReviewOperationalMetrics()
    const rawData = row.id ? pageRawDataById.get(row.id) ?? row.rawData : row.rawData
    return {
      ...row,
      rawData,
      chinaCurrentStock: metrics.chinaCurrentStock,
      purchaseReviewMetrics: metrics,
      purchaseReviewHistory: purchaseReviewHistoryFromMetrics(metrics),
      purchaseUrgencyStatus: getProductGroupPurchaseUrgencyStatus({
        sku: row.sku,
        productName: row.productName,
        urgentProductNames,
      }),
    }
  })

  return {
    items,
    total,
    costTotals: summarizePurchaseCosts(costRows, input.exchangeRateKrw),
    missingCostItems,
    reviewStatusCounts: {
      review: baseRows.filter((row) => row.reviewStatus === 'review').length,
      not_required: baseRows.filter((row) => row.reviewStatus === 'not_required').length,
    } satisfies Record<PurchaseReviewListStatus, number>,
    statusCounts: {
      requested: baseRows.filter((row) => row.reviewStatus === 'review').length,
    } satisfies Partial<Record<PurchaseRequestStatus, number>>,
    overduePurchasedCount: 0,
    overduePurchaseRequestCount: 0,
    overduePurchaseCompletedCount: 0,
    overdueTotalCount: 0,
  }
}

function latestPurchaseReviewRowBySku<T extends {
  sku: string
  requestedQuantity: number
  updatedAt: Date
  createdAt: Date
}>(rows: readonly T[]) {
  const latestBySku = new Map<string, T>()
  for (const row of rows) {
    const current = latestBySku.get(row.sku)
    if (!current || shouldReplacePurchaseReviewRow(current, row)) latestBySku.set(row.sku, row)
  }
  return latestBySku
}

function shouldReplacePurchaseReviewRow<T extends {
  requestedQuantity: number
  updatedAt: Date
  createdAt: Date
}>(current: T, candidate: T) {
  const currentHasQuantity = current.requestedQuantity > 0
  const candidateHasQuantity = candidate.requestedQuantity > 0
  if (currentHasQuantity !== candidateHasQuantity) return candidateHasQuantity
  const currentUpdatedAt = current.updatedAt.getTime()
  const candidateUpdatedAt = candidate.updatedAt.getTime()
  if (currentUpdatedAt !== candidateUpdatedAt) return candidateUpdatedAt > currentUpdatedAt
  return candidate.createdAt.getTime() > current.createdAt.getTime()
}

function normalizePurchaseReviewListStatuses(value: readonly PurchaseReviewListStatus[] | undefined) {
  const selected = Array.from(new Set(value ?? []))
    .filter((status): status is PurchaseReviewListStatus => PURCHASE_REVIEW_LIST_STATUSES.includes(status))
  return selected.length > 0 ? selected : [...PURCHASE_REVIEW_LIST_STATUSES]
}

function purchaseReviewRawDataSummary(
  source: string | null | undefined,
  stockCoverageMonths: string | null | undefined,
): Record<string, unknown> {
  if (source !== 'auto_purchase_recommendation') return {}

  const rawData: Record<string, unknown> = { source }
  if (stockCoverageMonths !== null && stockCoverageMonths !== undefined) {
    rawData.stockCoverageMonths = stockCoverageMonths
  }
  return rawData
}

function matchesPurchaseReviewSearch(row: {
  sku: string
  productName: string
  optionName: string | null
  purchaseUrl: string | null
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
  memo: string | null
  rawData: Record<string, unknown>
  metadata: Record<string, unknown> | null
}, normalizedSearch: string) {
  if (!normalizedSearch) return true
  const metadataText = JSON.stringify(row.metadata?.esa009m ?? {}).toLocaleLowerCase('ko-KR')
  const rawDataText = JSON.stringify(row.rawData).toLocaleLowerCase('ko-KR')
  return [
    row.sku,
    row.productName,
    row.optionName ?? '',
    row.purchaseUrl ?? '',
    row.purchaseManagementCode ?? '',
    row.supplierOrderNumber ?? '',
    row.memo ?? '',
    metadataText,
    rawDataText,
  ]
    .some((value) => value.toLocaleLowerCase('ko-KR').includes(normalizedSearch))
}

function sortPurchaseReviewListRows<T extends {
  reviewStatus: PurchaseReviewListStatus
  sku: string
  productName: string
  optionName: string | null
  requestedQuantity: number
  unitCostYuan: number | null
  unitCostKrw: number | null
  totalCostYuan: number | null
  totalCostKrw: number | null
}>(rows: readonly T[], sort?: string, order?: string) {
  const direction = order === 'desc' ? -1 : 1
  const compareText = (left: string, right: string) => left.localeCompare(right, 'ko-KR')
  const compareNumber = (left: number | null, right: number | null) => (left ?? -1) - (right ?? -1)
  return [...rows].sort((left, right) => {
    let compared = 0
    switch (sort) {
      case 'status':
        compared = Number(left.reviewStatus === 'not_required') - Number(right.reviewStatus === 'not_required')
        break
      case 'productName':
        compared = compareText(left.productName, right.productName)
        break
      case 'sku':
        compared = compareText(left.sku, right.sku)
        break
      case 'requestedQuantity':
        compared = compareNumber(left.requestedQuantity, right.requestedQuantity)
        break
      case 'unitCostYuan':
        compared = compareNumber(left.unitCostYuan, right.unitCostYuan)
        break
      case 'unitCostKrw':
        compared = compareNumber(left.unitCostKrw, right.unitCostKrw)
        break
      case 'totalCostYuan':
        compared = compareNumber(left.totalCostYuan, right.totalCostYuan)
        break
      case 'totalCostKrw':
        compared = compareNumber(left.totalCostKrw, right.totalCostKrw)
        break
      default:
        compared = Number(left.reviewStatus === 'not_required') - Number(right.reviewStatus === 'not_required')
        if (compared !== 0) return compared
        compared = compareText(left.sku, right.sku)
        if (compared !== 0) return compared
        return compareText(left.optionName ?? '', right.optionName ?? '')
    }
    if (compared !== 0) return compared * direction
    const skuComparison = compareText(left.sku, right.sku)
    if (skuComparison !== 0) return skuComparison
    return compareText(left.optionName ?? '', right.optionName ?? '')
  })
}

const PURCHASE_REVIEW_HISTORY_STATUSES = [
  'purchase_completed',
  'china_arrived',
  'outbound_requested',
  'completed',
] as const satisfies PurchaseRequestStatus[]

export async function getPurchaseReviewHistoryBySku(
  userId: string,
  skus: readonly string[],
): Promise<Map<string, PurchaseReviewHistory>> {
  const uniqueSkus = Array.from(new Set(skus.filter(Boolean)))
  if (uniqueSkus.length === 0) return new Map()

  const historyRows = await db
    .select({
      sku: purchaseRequestItems.sku,
      requestedQuantity: purchaseRequestItems.requestedQuantity,
      actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
      requestDate: purchaseRequestItems.requestDate,
      outboundExpectedDate: purchaseRequestItems.outboundExpectedDate,
      rawData: purchaseRequestItems.rawData,
      createdAt: purchaseRequestItems.createdAt,
    })
    .from(purchaseRequestItems)
    .where(and(
      eq(purchaseRequestItems.userId, userId),
      inArray(purchaseRequestItems.sku, uniqueSkus),
      or(
        inArray(purchaseRequestItems.status, [...PURCHASE_REVIEW_HISTORY_STATUSES]),
        and(
          eq(purchaseRequestItems.status, 'purchased'),
          eq(purchaseRequestItems.purchaseConfirmed, true),
        ),
      )!,
    ))

  const latestHistoryBySku = getLatestPurchaseReviewHistoryCandidates(historyRows)
  if (latestHistoryBySku.size === 0) return new Map()

  const historyValues = sql.join(
    Array.from(latestHistoryBySku.values()).map((row) => sql`(${row.sku}, ${purchaseReviewHistoryDate(row)}::date)`),
    sql`, `,
  )
  const threeMonthAverageResult = await db.execute<{
    sku: string
    threeMonthAverageOutgoing: string | number | null
  }>(sql`
    WITH purchase_history (sku, purchase_date) AS (
      VALUES ${historyValues}
    )
    SELECT
      history.sku AS "sku",
      (COALESCE(SUM(
        CASE WHEN line.claim_type = 'return' THEN -line.quantity ELSE line.quantity END
      ), 0) / 3.0)::numeric AS "threeMonthAverageOutgoing"
    FROM purchase_history history
    LEFT JOIN outbound_reflection_lines line
      ON line.user_id = ${userId}::uuid
      AND line.sku = history.sku
      AND line.reflection_status = 'applied'
      AND line.shipment_date >= (date_trunc('month', history.purchase_date) - INTERVAL '3 months')::date
      AND line.shipment_date < date_trunc('month', history.purchase_date)::date
    GROUP BY history.sku
  `)
  const calculatedAverageBySku = new Map(resultRows<{
    sku: string
    threeMonthAverageOutgoing: string | number | null
  }>(threeMonthAverageResult).map((row) => [row.sku, positiveOneDecimal(row.threeMonthAverageOutgoing)]))

  return new Map(Array.from(latestHistoryBySku.entries()).map(([sku, row]) => [
    sku,
    {
      lastPurchaseDate: purchaseReviewHistoryDate(row),
      lastPurchaseQuantity: row.actualPurchaseQuantity ?? row.requestedQuantity,
      threeMonthAverageOutgoingAtLastPurchase: getStoredPurchaseReviewAverage(row.rawData)
        ?? calculatedAverageBySku.get(sku)
        ?? 0,
    },
  ]))
}

/**
 * Returns the live quantities needed to judge a SKU before adding it to a
 * purchase review. Purchase-stage rows and China-outbound rows stay separate
 * so the same units are not counted twice in the UI or export.
 */
export async function getPurchaseReviewOperationalMetricsBySku(input: {
  userId: string
  skus: readonly string[]
  targetStockMonths?: number
}): Promise<Map<string, PurchaseReviewOperationalMetrics>> {
  const uniqueSkus = Array.from(new Set(input.skus.map((sku) => sku.trim()).filter(Boolean)))
  if (uniqueSkus.length === 0) return new Map()

  const targetStockMonths = normalizeTargetStockMonths(input.targetStockMonths)
  const [
    domesticInventoryRows,
    chinaInventoryRows,
    activePurchaseRows,
    outgoingMetricsBySku,
    purchaseHistoryBySku,
  ] = await Promise.all([
    db
      .select({
        sku: inventory.sku,
        availableStock: sql<number>`COALESCE(SUM(CASE WHEN ${inventory.warehouseZone} IN ('1창고', '쿠팡창고', '쿠팡', '2창고') THEN ${inventory.availableStock} ELSE 0 END), 0)::int`,
      })
      .from(inventory)
      .where(and(
        eq(inventory.userId, input.userId),
        inArray(inventory.sku, uniqueSkus),
      ))
      .groupBy(inventory.sku),
    db
      .select({
        sku: chinaWarehouseInventory.sku,
        availableStock: sql<number>`COALESCE(SUM(${chinaWarehouseInventory.availableQuantity}), 0)::int`,
      })
      .from(chinaWarehouseInventory)
      .where(and(
        eq(chinaWarehouseInventory.userId, input.userId),
        inArray(chinaWarehouseInventory.sku, uniqueSkus),
      ))
      .groupBy(chinaWarehouseInventory.sku),
    db
      .select({
        sku: purchaseRequestItems.sku,
        status: purchaseRequestItems.status,
        requestedQuantity: purchaseRequestItems.requestedQuantity,
        actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
        chinaReceivedQuantity: purchaseRequestItems.chinaReceivedQuantity,
        rawData: purchaseRequestItems.rawData,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        inArray(purchaseRequestItems.sku, uniqueSkus),
        inArray(purchaseRequestItems.status, [...ACTIVE_PURCHASE_PAYMENT_STATUSES]),
      )),
    getSkuOutgoingMetrics(input.userId, uniqueSkus),
    getPurchaseReviewHistoryBySku(input.userId, uniqueSkus),
  ])

  const domesticStockBySku = quantityBySku(domesticInventoryRows)
  const chinaStockBySku = quantityBySku(chinaInventoryRows)
  const pipelineBySku = summarizePurchaseReviewPipelineQuantities(activePurchaseRows)

  return new Map(uniqueSkus.map((sku) => {
    const outgoing = outgoingMetricsBySku.get(sku)
    const history = purchaseHistoryBySku.get(sku)
    const domesticCurrentStock = domesticStockBySku.get(sku) ?? 0
    const chinaCurrentStock = chinaStockBySku.get(sku) ?? 0
    const threeMonthAverageOutgoing = outgoing?.threeMonthAverageOutgoing ?? 0
    const pipeline = pipelineBySku.get(sku) ?? emptyPurchaseReviewPipelineQuantities()

    return [sku, {
      lastPurchaseDate: history?.lastPurchaseDate ?? null,
      lastPurchaseQuantity: history?.lastPurchaseQuantity ?? null,
      lastPurchaseThreeMonthAverageOutgoing: history?.threeMonthAverageOutgoingAtLastPurchase ?? null,
      purchaseInProgressQuantity: pipeline.purchaseInProgressQuantity,
      chinaOutboundScheduledQuantity: pipeline.chinaOutboundScheduledQuantity,
      domesticCurrentStock,
      chinaCurrentStock,
      currentStock: domesticCurrentStock + chinaCurrentStock,
      currentMonthOutgoing: outgoing?.currentMonthOutgoing ?? 0,
      threeMonthAverageOutgoing,
      targetStockQuantity: calculatePurchaseReviewTargetQuantity(threeMonthAverageOutgoing, targetStockMonths),
    }]
  }))
}

export function summarizePurchaseReviewPipelineQuantities(
  rows: readonly PurchaseReviewPipelineRow[],
): Map<string, PurchaseReviewPipelineQuantities> {
  const quantitiesBySku = new Map<string, PurchaseReviewPipelineQuantities>()

  for (const row of rows) {
    const current = quantitiesBySku.get(row.sku) ?? emptyPurchaseReviewPipelineQuantities()
    if (row.status === 'outbound_requested') {
      current.chinaOutboundScheduledQuantity += getOutboundRequestedQuantity(row)
    } else if (
      row.status === 'purchased'
      || row.status === 'purchase_completed'
      || row.status === 'china_arrived'
    ) {
      current.purchaseInProgressQuantity += purchasePipelineQuantity(row)
    }
    quantitiesBySku.set(row.sku, current)
  }

  return quantitiesBySku
}

export function calculatePurchaseReviewTargetQuantity(
  threeMonthAverageOutgoing: number,
  targetStockMonths = 1.2,
) {
  const average = Number.isFinite(threeMonthAverageOutgoing)
    ? Math.max(0, threeMonthAverageOutgoing)
    : 0
  if (average <= 0) return 0
  return Math.ceil(average * normalizeTargetStockMonths(targetStockMonths))
}

export async function searchManualPurchaseCandidates(input: {
  userId: string
  query: string
  targetStockMonths?: number
  limit?: number
}) {
  const query = input.query.trim()
  if (!query) return []

  const limit = Math.min(50, Math.max(1, Math.trunc(input.limit ?? 20)))
  const pattern = `%${query}%`
  const optionName = sql<string | null>`NULLIF(BTRIM(COALESCE(${products.metadata}->'esa009m'->>'규격정보', '')), '')`
  const productRows = await db
    .select({
      sku: products.internalSku,
      productName: products.name,
      optionName,
    })
    .from(products)
    .where(and(
      eq(products.userId, input.userId),
      or(
        ilike(products.internalSku, pattern),
        ilike(products.name, pattern),
        sql`COALESCE(${products.metadata}->'esa009m'->>'규격정보', '') ILIKE ${pattern}`,
      )!,
    ))
    .orderBy(asc(products.internalSku))
    .limit(limit)

  const metricsBySku = await getPurchaseReviewOperationalMetricsBySku({
    userId: input.userId,
    skus: productRows.map((row) => row.sku),
    targetStockMonths: input.targetStockMonths,
  })

  return productRows.map((row) => ({
    sku: row.sku,
    productName: row.productName,
    optionName: row.optionName,
    ...(metricsBySku.get(row.sku) ?? emptyPurchaseReviewOperationalMetrics()),
  }))
}

function emptyPurchaseReviewPipelineQuantities(): PurchaseReviewPipelineQuantities {
  return {
    purchaseInProgressQuantity: 0,
    chinaOutboundScheduledQuantity: 0,
  }
}

function emptyPurchaseReviewOperationalMetrics(): PurchaseReviewOperationalMetrics {
  return {
    lastPurchaseDate: null,
    lastPurchaseQuantity: null,
    lastPurchaseThreeMonthAverageOutgoing: null,
    ...emptyPurchaseReviewPipelineQuantities(),
    domesticCurrentStock: 0,
    chinaCurrentStock: 0,
    currentStock: 0,
    currentMonthOutgoing: 0,
    threeMonthAverageOutgoing: 0,
    targetStockQuantity: 0,
  }
}

function purchaseReviewHistoryFromMetrics(
  metrics: PurchaseReviewOperationalMetrics | undefined,
): PurchaseReviewHistory | null {
  if (!metrics?.lastPurchaseDate || metrics.lastPurchaseQuantity === null) return null
  return {
    lastPurchaseDate: metrics.lastPurchaseDate,
    lastPurchaseQuantity: metrics.lastPurchaseQuantity,
    threeMonthAverageOutgoingAtLastPurchase: metrics.lastPurchaseThreeMonthAverageOutgoing ?? 0,
  }
}

function quantityBySku(rows: ReadonlyArray<{ sku: string; availableStock: number | string | null }>) {
  return new Map(rows.map((row) => [row.sku, metricQuantity(row.availableStock)]))
}

function metricQuantity(value: number | string | null | undefined) {
  const quantity = Number(value)
  return Number.isFinite(quantity) ? Math.trunc(quantity) : 0
}

function normalizeTargetStockMonths(value: number | undefined) {
  if (!Number.isFinite(value)) return 1.2
  return Math.min(12, Math.max(0.1, value!))
}

export function getStoredPurchaseReviewAverage(rawData: Record<string, unknown>): number | null {
  const averageMonthlyOutgoing = Number(rawData.averageMonthlyOutgoing)
  if (!Number.isFinite(averageMonthlyOutgoing) || averageMonthlyOutgoing < 0) return null
  return Math.round(averageMonthlyOutgoing * 10) / 10
}

export function getLatestPurchaseReviewHistoryCandidates(
  rows: readonly PurchaseReviewHistoryCandidate[],
): Map<string, PurchaseReviewHistoryCandidate> {
  const latestBySku = new Map<string, PurchaseReviewHistoryCandidate>()
  for (const row of rows) {
    const current = latestBySku.get(row.sku)
    if (!current || comparePurchaseReviewHistoryCandidates(row, current) > 0) {
      latestBySku.set(row.sku, row)
    }
  }
  return latestBySku
}

function comparePurchaseReviewHistoryCandidates(
  left: PurchaseReviewHistoryCandidate,
  right: PurchaseReviewHistoryCandidate,
) {
  const leftDate = purchaseReviewHistoryDate(left)
  const rightDate = purchaseReviewHistoryDate(right)
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate)
  return left.createdAt.getTime() - right.createdAt.getTime()
}

function purchaseReviewHistoryDate(row: PurchaseReviewHistoryCandidate) {
  return row.requestDate ?? row.outboundExpectedDate ?? row.createdAt.toISOString().slice(0, 10)
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
  if (input.status === 'china_arrived' || input.status === 'outbound_requested' || input.status === 'completed') {
    await ensureSaasChinaOutboundSchema()
  }
  const exchangeRateReference = input.status === 'requested'
    ? null
    : await getLatestCnyKrwReferenceRate()

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    const [current] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!current) return null
    if (current.status === input.status) return { id: current.id }

    const saasChinaMode = usesSaasChinaInventory(current.rawData)
    if (saasChinaMode) {
      const hasSaasChinaLink = await hasSaasChinaPurchaseLinkInTransaction({
        tx,
        userId: input.userId,
        purchaseRequestItemId: current.id,
      })
      if (hasSaasChinaLink) {
        throw new Error('SaaS 중국재고에 입고된 발주는 중국출고 작업에서만 상태와 수량을 변경할 수 있습니다.')
      }
      if (input.status === 'outbound_requested' || input.status === 'completed') {
        throw new Error('SaaS 중국재고 연동 발주는 중국출고 작업에서 예약·출고완료 처리해주세요.')
      }
    }

    if (input.status === 'china_arrived') {
      if (saasChinaMode) {
        await receiveSaasChinaPurchaseArrivalInTransaction(tx, {
          userId: input.userId,
          createdBy: input.userId,
          purchaseRequestItemId: current.id,
          sku: current.sku,
          productName: current.productName,
          optionName: current.optionName,
          quantity: purchaseQuantity(current),
        })
      } else {
        await addChinaWarehouseStock(tx, current)
      }
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
  trackingNumber?: string | null
  outboundExpectedDate?: string | null
  purchaseMethod?: string | null
  purchaseConfirmed?: boolean
  paymentStatus?: PurchasePaymentStatus
  bulkPaymentPending?: boolean
  bulkPaymentDueDate?: string | null
  buyerCode?: string | null
  buyerName?: string | null
  delayReason?: PurchaseDelayReason | null
  delayNote?: string | null
  applyDelayReasonToItem?: boolean
  saasChinaMode?: boolean
}) {
  await ensurePurchasePaymentTrackingSchema()
  if (input.saasChinaMode !== undefined || input.chinaReceivedQuantity !== undefined || input.outboundRequestedQuantity !== undefined) {
    await ensureSaasChinaOutboundSchema()
  }
  const requestedQuantity = normalizePurchaseRequestQuantity(input.requestedQuantity)
  const actualPurchaseQuantity = normalizeOptionalPurchaseRequestQuantity(input.actualPurchaseQuantity)
  const chinaReceivedQuantity = normalizeOptionalPurchaseRequestQuantity(input.chinaReceivedQuantity)
  const outboundRequestedQuantity = normalizeOptionalPurchaseRequestQuantity(input.outboundRequestedQuantity)
  if (requestedQuantity === null) return null
  if (actualPurchaseQuantity === null) return null
  if (chinaReceivedQuantity === null) return null
  if (outboundRequestedQuantity === null) return null
  const now = new Date()
  const shouldReconcileFund = input.supplierOrderNumber !== undefined
    || requestedQuantity !== undefined
    || actualPurchaseQuantity !== undefined
  if (shouldReconcileFund) await ensurePurchaseFundLedgerSchema()
  const exchangeRateReference = input.paymentStatus === undefined && !shouldReconcileFund
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
  if (input.trackingNumber !== undefined) {
    values.trackingNumber = emptyToNull(input.trackingNumber)
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
  if (input.bulkPaymentPending !== undefined) {
    values.bulkPaymentPending = input.bulkPaymentPending
    if (!input.bulkPaymentPending) values.bulkPaymentDueDate = null
  }
  if (input.bulkPaymentDueDate !== undefined) {
    values.bulkPaymentDueDate = input.bulkPaymentDueDate || null
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
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    const [current] = await tx
      .select()
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!current) return null

    const effectiveBulkPaymentPending = input.bulkPaymentPending ?? current.bulkPaymentPending
    if (input.bulkPaymentDueDate && !effectiveBulkPaymentPending) return null

    if (input.paymentStatus !== undefined && !current.costExchangeRateKrw && exchangeRateReference) {
      values.costExchangeRateKrw = String(exchangeRateReference.rate)
      values.costExchangeRateDate = exchangeRateReference.date ?? todayKstDate()
    }

    const currentSaasChinaMode = usesSaasChinaInventory(current.rawData)
    if (input.saasChinaMode !== undefined) {
      const canChangeSaasMode = current.status === 'purchased' || current.status === 'purchase_completed'
      if (!canChangeSaasMode && input.saasChinaMode !== currentSaasChinaMode) {
        throw new Error('SaaS 중국재고 연동은 중국창고도착 전에만 변경할 수 있습니다.')
      }
      if (!input.saasChinaMode && currentSaasChinaMode) {
        const hasLink = await hasSaasChinaPurchaseLinkInTransaction({
          tx,
          userId: input.userId,
          purchaseRequestItemId: current.id,
        })
        if (hasLink) {
          throw new Error('이미 SaaS 중국재고에 입고된 발주는 연동을 해제할 수 없습니다.')
        }
      }
    }
    const saasChinaMode = input.saasChinaMode ?? currentSaasChinaMode
    const saasChinaModeChanged = input.saasChinaMode !== undefined && input.saasChinaMode !== currentSaasChinaMode
    if (saasChinaMode && outboundRequestedQuantity !== undefined) {
      throw new Error('SaaS 중국재고 연동 발주의 출고요청수량은 중국출고 작업에서만 변경할 수 있습니다.')
    }

    if (saasChinaModeChanged || outboundRequestedQuantity !== undefined) {
      values.rawData = {
        ...current.rawData,
        ...(saasChinaModeChanged ? { saasChinaMode: input.saasChinaMode } : {}),
        ...(outboundRequestedQuantity !== undefined ? { outboundRequestedQuantity } : {}),
      }
    }
    if (chinaReceivedQuantity !== undefined) {
      if (saasChinaMode) {
        if (current.status !== 'china_arrived') {
          throw new Error('SaaS 중국재고 연동 발주의 중국도착수량은 중국창고도착 이후에만 수정할 수 있습니다.')
        }
        await adjustSaasChinaPurchaseArrivalQuantityInTransaction({
          tx,
          userId: input.userId,
          createdBy: input.userId,
          purchaseRequestItemId: current.id,
          quantity: chinaReceivedQuantity,
        })
      } else {
        await adjustChinaWarehouseArrivalQuantity(tx, current, chinaReceivedQuantity)
      }
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

    if (shouldReconcileFund) {
      await reconcilePurchaseFundDebitsInTransaction(tx, {
        userId: input.userId,
        fallbackExchangeRateKrw: exchangeRateReference?.rate ?? 200,
        existingEntryMode: 'preserve',
      })
    }

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

export async function updatePurchaseRequestBulkPaymentDeposit(input: {
  userId: string
  id: string
  depositCny: number
  depositPaidAt: string | null
  depositMemo: string | null
}) {
  await ensurePurchasePaymentTrackingSchema()
  if (!Number.isFinite(input.depositCny) || input.depositCny < 0) {
    throw new Error('선금은 0 이상의 숫자로 입력해주세요.')
  }

  const depositCny = roundMoney(input.depositCny)
  const exchangeRateReference = await getLatestCnyKrwReferenceRate()
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    const [current] = await tx
      .select({
        id: purchaseRequestItems.id,
        bulkPaymentPending: purchaseRequestItems.bulkPaymentPending,
        requestedQuantity: purchaseRequestItems.requestedQuantity,
        actualPurchaseQuantity: purchaseRequestItems.actualPurchaseQuantity,
        costExchangeRateKrw: purchaseRequestItems.costExchangeRateKrw,
        specialPriceCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'특가(元)', '')`,
        newCostCny: sql<string | null>`NULLIF(${products.metadata}->'esa009m'->>'신규원가(元)', '')`,
      })
      .from(purchaseRequestItems)
      .leftJoin(products, and(
        eq(products.userId, purchaseRequestItems.userId),
        eq(products.internalSku, purchaseRequestItems.sku),
      ))
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        eq(purchaseRequestItems.id, input.id),
      ))
      .limit(1)

    if (!current || !current.bulkPaymentPending) return null

    const costs = calculatePurchaseCosts({
      requestedQuantity: purchaseCostQuantity(current),
      specialPriceCny: current.specialPriceCny,
      newCostCny: current.newCostCny,
      exchangeRateKrw: current.costExchangeRateKrw ?? exchangeRateReference.rate,
    })
    if (costs.totalCostYuan === null || costs.totalCostKrw === null) {
      throw new Error('상품 원가와 적용환율을 확인한 뒤 선금을 입력해주세요.')
    }
    if (depositCny > costs.totalCostYuan + 0.001) {
      throw new Error(`선금은 현재 발주금액 ${costs.totalCostYuan.toLocaleString('ko-KR')}元을 넘을 수 없습니다.`)
    }

    const appliedExchangeRate = calculateAppliedPurchaseExchangeRateKrw(
      current.costExchangeRateKrw ?? exchangeRateReference.rate,
    )
    if (depositCny > 0 && appliedExchangeRate === null) {
      throw new Error('적용환율을 확인한 뒤 선금을 입력해주세요.')
    }

    const isClearing = depositCny === 0
    const [row] = await tx
      .update(purchaseRequestItems)
      .set({
        bulkPaymentDepositCny: String(depositCny),
        bulkPaymentDepositKrw: String(isClearing ? 0 : Math.round(depositCny * appliedExchangeRate!)),
        bulkPaymentDepositPaidAt: isClearing ? null : input.depositPaidAt || todayKstDate(),
        bulkPaymentDepositMemo: isClearing ? null : emptyToNull(input.depositMemo),
        updatedAt: new Date(),
      })
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        eq(purchaseRequestItems.id, input.id),
      ))
      .returning({ id: purchaseRequestItems.id })

    return row ?? null
  })
}

/**
 * Marks the selected bulk-payment rows as paid without advancing the purchase
 * lifecycle or touching either China or domestic inventory. The payment-flow
 * lists use this state to hide an already-settled bulk balance.
 */
export async function completeBulkPaymentPurchaseRequestItems(input: {
  userId: string
  ids: string[]
}) {
  const ids = Array.from(new Set(input.ids))
  if (ids.length === 0) {
    return { completedIds: [], ineligibleIds: [], missingIds: [] }
  }

  await ensurePurchasePaymentTrackingSchema()

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    const workspaceRows = await tx
      .select({
        id: purchaseRequestItems.id,
        status: purchaseRequestItems.status,
        bulkPaymentPending: purchaseRequestItems.bulkPaymentPending,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        inArray(purchaseRequestItems.id, ids),
      ))

    const workspaceIds = new Set(workspaceRows.map((row) => row.id))
    const eligibleIds = workspaceRows
      .filter((row) => (
        ACTIVE_PURCHASE_PAYMENT_STATUSES.includes(row.status as (typeof ACTIVE_PURCHASE_PAYMENT_STATUSES)[number])
        && row.bulkPaymentPending
      ))
      .map((row) => row.id)

    const completedRows = eligibleIds.length === 0
      ? []
      : await tx
        .update(purchaseRequestItems)
        .set({
          paymentStatus: 'paid',
          // Keep an existing paid-at timestamp when this is only clearing a
          // stale bulk-pending marker from a previously paid item.
          paymentPaidAt: sql`COALESCE(${purchaseRequestItems.paymentPaidAt}, now())`,
          bulkPaymentPending: false,
          bulkPaymentDueDate: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(purchaseRequestItems.userId, input.userId),
          inArray(purchaseRequestItems.id, eligibleIds),
          inArray(purchaseRequestItems.status, [...ACTIVE_PURCHASE_PAYMENT_STATUSES]),
          eq(purchaseRequestItems.bulkPaymentPending, true),
        ))
        .returning({ id: purchaseRequestItems.id })

    const completedIds = new Set(completedRows.map((row) => row.id))
    return {
      completedIds: [...completedIds],
      ineligibleIds: [...workspaceIds].filter((id) => !completedIds.has(id)),
      missingIds: ids.filter((id) => !workspaceIds.has(id)),
    }
  })
}

export async function updatePurchaseRequestPlanFieldsBulk(input: {
  userId: string
  ids: string[]
  buyerCode?: string | null
  bulkPaymentPending?: boolean
  bulkPaymentDueDate?: string | null
}) {
  await ensurePurchasePaymentTrackingSchema()

  const ids = Array.from(new Set(input.ids))
  if (ids.length === 0) return []
  if (input.bulkPaymentDueDate !== undefined && input.bulkPaymentPending === undefined) {
    throw new Error('대량결제 예정일을 변경하려면 대량결제대기 여부도 함께 지정해야 합니다.')
  }
  if (input.bulkPaymentPending === false && input.bulkPaymentDueDate) {
    throw new Error('대량결제대기 해제 시 예정일을 지정할 수 없습니다.')
  }

  const values: Partial<typeof purchaseRequestItems.$inferInsert> = {
    updatedAt: new Date(),
  }
  if (input.buyerCode !== undefined) {
    const buyerCode = normalizePurchaseBuyerCode(input.buyerCode)
    values.buyerCode = buyerCode
    values.buyerName = PURCHASE_BUYERS[buyerCode]
  }
  if (input.bulkPaymentPending !== undefined) {
    values.bulkPaymentPending = input.bulkPaymentPending
    values.bulkPaymentDueDate = input.bulkPaymentPending
      ? input.bulkPaymentDueDate || null
      : null
  }

  if (input.buyerCode === undefined && input.bulkPaymentPending === undefined) return []

  return db
    .update(purchaseRequestItems)
    .set(values)
    .where(and(
      eq(purchaseRequestItems.userId, input.userId),
      inArray(purchaseRequestItems.id, ids),
    ))
    .returning({ id: purchaseRequestItems.id })
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
  const [, , exchangeRateReference] = await Promise.all([
    ensurePurchaseFundLedgerSchema(),
    ensureSaasChinaOutboundSchema(),
    getLatestCnyKrwReferenceRate(),
  ])
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    await reconcilePurchaseFundDebitsInTransaction(tx, {
      userId: input.userId,
      fallbackExchangeRateKrw: exchangeRateReference.rate,
      existingEntryMode: 'preserve',
    })
    const [item] = await tx
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .where(and(eq(purchaseRequestItems.userId, input.userId), eq(purchaseRequestItems.id, input.id)))
      .limit(1)

    if (!item) return null

    if (await hasSaasChinaPurchaseLinkInTransaction({
      tx,
      userId: input.userId,
      purchaseRequestItemId: item.id,
    })) {
      throw new Error('SaaS 중국재고 또는 중국출고와 연결된 발주는 삭제할 수 없습니다.')
    }

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

export async function deletePurchaseRequestItemsWithoutInventoryMovements(input: {
  userId: string
  ids: string[]
}) {
  const ids = Array.from(new Set(input.ids))
  if (ids.length === 0) {
    return { deletedIds: [], inventoryLinkedIds: [], ineligibleIds: [], missingIds: [] }
  }

  await Promise.all([
    ensureIgnoredPurchasingItemsTable(),
    ensureSaasChinaOutboundSchema(),
  ])

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    const workspaceRows = await tx
      .select()
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        inArray(purchaseRequestItems.id, ids),
      ))
    const workspaceIds = new Set(workspaceRows.map((row) => row.id))
    const eligibleRows = workspaceRows.filter((row) => (
      ACTIVE_PURCHASE_PAYMENT_STATUSES.includes(row.status as (typeof ACTIVE_PURCHASE_PAYMENT_STATUSES)[number])
      && !row.supplierOrderNumber?.trim()
    ))
    const eligibleIds = new Set(eligibleRows.map((row) => row.id))

    const movementRows = eligibleIds.size === 0
      ? []
      : await tx
        .select({ purchaseRequestItemId: chinaWarehouseInventoryMovements.purchaseRequestItemId })
        .from(chinaWarehouseInventoryMovements)
        .where(and(
          eq(chinaWarehouseInventoryMovements.userId, input.userId),
          inArray(chinaWarehouseInventoryMovements.purchaseRequestItemId, [...eligibleIds]),
        ))
    const saasLinkRows = eligibleIds.size === 0
      ? []
      : await tx
        .select({ purchaseRequestItemId: saasChinaPurchaseLinks.purchaseRequestItemId })
        .from(saasChinaPurchaseLinks)
        .where(and(
          eq(saasChinaPurchaseLinks.userId, input.userId),
          inArray(saasChinaPurchaseLinks.purchaseRequestItemId, [...eligibleIds]),
        ))
    const inventoryLinkedIds = new Set([
      ...movementRows.map((row) => row.purchaseRequestItemId),
      ...saasLinkRows.map((row) => row.purchaseRequestItemId),
    ])
    const deletableIds = [...eligibleIds].filter((id) => !inventoryLinkedIds.has(id))

    const deletedRows = deletableIds.length === 0
      ? []
      : await tx
        .delete(purchaseRequestItems)
        .where(and(
          eq(purchaseRequestItems.userId, input.userId),
          inArray(purchaseRequestItems.id, deletableIds),
          inArray(purchaseRequestItems.status, [...ACTIVE_PURCHASE_PAYMENT_STATUSES]),
          sql`NULLIF(BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')), '') IS NULL`,
          sql`NOT EXISTS (
            SELECT 1
            FROM ${chinaWarehouseInventoryMovements}
            WHERE ${chinaWarehouseInventoryMovements.purchaseRequestItemId} = ${purchaseRequestItems.id}
          )`,
          sql`NOT EXISTS (
            SELECT 1
            FROM ${saasChinaPurchaseLinks}
            WHERE ${saasChinaPurchaseLinks.purchaseRequestItemId} = ${purchaseRequestItems.id}
          )`,
        ))
        .returning({ id: purchaseRequestItems.id })
    const deletedIds = new Set(deletedRows.map((row) => row.id))

    await ignorePurchasingItemsInTransaction(tx, {
      userId: input.userId,
      items: eligibleRows
        .filter((row) => deletedIds.has(row.id))
        .flatMap((row) => purchaseRequestItemIgnoreIdentityKeys(row).map((identityKey) => ({
          identityKey,
          reason: '사용자 삭제',
        }))),
    })

    return {
      deletedIds: [...deletedIds],
      inventoryLinkedIds: [...inventoryLinkedIds],
      ineligibleIds: [...workspaceIds].filter((id) => !eligibleIds.has(id)),
      missingIds: ids.filter((id) => !workspaceIds.has(id)),
    }
  })
}

export async function completeOutstandingPurchaseRequestItems(input: {
  userId: string
  ids: string[]
}) {
  const ids = Array.from(new Set(input.ids))
  if (ids.length === 0) {
    return { completedIds: [], ineligibleIds: [], missingIds: [] }
  }

  await Promise.all([
    ensurePurchasePaymentTrackingSchema(),
    ensureIgnoredPurchasingItemsTable(),
    ensureSaasChinaOutboundSchema(),
  ])

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    const workspaceRows = await tx
      .select()
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        inArray(purchaseRequestItems.id, ids),
      ))
    const workspaceIds = new Set(workspaceRows.map((row) => row.id))
    const eligibleRows = workspaceRows.filter((row) => (
      isOutstandingPurchasePaymentRow(row) && !usesSaasChinaInventory(row.rawData)
    ))
    const eligibleIds = eligibleRows.map((row) => row.id)

    const completedRows = eligibleIds.length === 0
      ? []
      : await tx
        .update(purchaseRequestItems)
        .set({
          status: 'completed',
          // Moving the raw source out of the replaceable Ecount namespace
          // keeps the completed row and its inventory movement history from
          // being cascade-deleted on a later raw-data upload.
          rawData: sql`${purchaseRequestItems.rawData} || jsonb_build_object(
            'originalSource', COALESCE(
              ${purchaseRequestItems.rawData}->>'originalSource',
              ${purchaseRequestItems.rawData}->>'source'
            ),
            'source', ${PAYMENT_FLOW_MANUALLY_COMPLETED_SOURCE},
            'paymentFlowManuallyCompleted', true,
            'paymentFlowCompletedAt', now()
          )`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(purchaseRequestItems.userId, input.userId),
          inArray(purchaseRequestItems.id, eligibleIds),
          inArray(purchaseRequestItems.status, [...ACTIVE_PURCHASE_PAYMENT_STATUSES]),
          sql`NULLIF(BTRIM(COALESCE(${purchaseRequestItems.supplierOrderNumber}, '')), '') IS NULL`,
          sql`COALESCE(${purchaseRequestItems.rawData}->'saasChinaMode', 'false'::jsonb) <> 'true'::jsonb`,
          sql`NOT EXISTS (
            SELECT 1
            FROM ${saasChinaPurchaseLinks}
            WHERE ${saasChinaPurchaseLinks.purchaseRequestItemId} = ${purchaseRequestItems.id}
          )`,
        ))
        .returning({ id: purchaseRequestItems.id })

    const completedIds = new Set(completedRows.map((row) => row.id))

    // Only touch inventory after the guarded update has actually claimed the
    // row. Another request may have filled an order number or changed status
    // after the initial read; those rows return no id and remain untouched.
    // Domestic inventory is separate and is never changed here.
    for (const row of eligibleRows) {
      if (!completedIds.has(row.id)) continue
      if (row.status === 'china_arrived') await addChinaWarehouseStock(tx, row)
      await subtractChinaWarehouseStock(tx, row)
    }

    await ignorePurchasingItemsInTransaction(tx, {
      userId: input.userId,
      items: eligibleRows
        .filter((row) => completedIds.has(row.id))
        .flatMap((row) => purchaseRequestItemIgnoreIdentityKeys(row).map((identityKey) => ({
          identityKey,
          reason: '결제 대기 목록 사용자 완료 처리',
        }))),
    })

    return {
      completedIds: [...completedIds],
      ineligibleIds: [...workspaceIds].filter((id) => !completedIds.has(id)),
      missingIds: ids.filter((id) => !workspaceIds.has(id)),
    }
  })
}

function isOutstandingPurchasePaymentRow(item: {
  status: PurchaseRequestStatus
  supplierOrderNumber: string | null
}) {
  return ACTIVE_PURCHASE_PAYMENT_STATUSES.includes(item.status as (typeof ACTIVE_PURCHASE_PAYMENT_STATUSES)[number])
    && !item.supplierOrderNumber?.trim()
}

function purchaseRequestItemIgnoreIdentityKeys(item: {
  sku: string
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
  rawData: Record<string, unknown>
}) {
  const source = typeof item.rawData.source === 'string' ? item.rawData.source : ''
  const stableOutboundOrderKey = Boolean(item.purchaseManagementCode?.trim())
    || isUniqueSupplierOrderIdentifier(item.supplierOrderNumber)
  const outboundEffectiveDate = typeof item.rawData.effectiveDate === 'string'
    ? item.rawData.effectiveDate.trim()
    : ''
  const identityInput = {
    source,
    sku: item.sku,
    purchaseManagementCode: item.purchaseManagementCode,
    supplierOrderNumber: item.supplierOrderNumber,
    fallbackDiscriminator: source === 'ecount_purchasing_snapshot_outbound'
      && stableOutboundOrderKey
      && outboundEffectiveDate
      ? outboundEffectiveDate
      : purchaseRequestItemFallbackDiscriminator(item.rawData),
    // One purchase line can leave China in several partial shipments. Each
    // outbound date/fallback key must remain independently closable.
    includeFallbackDiscriminator: source === 'ecount_purchasing_snapshot_outbound',
  }
  const keys = [purchasingItemIdentity(identityInput)]
  const isEcountSource = source === 'ecount_purchasing_replacement'
    || source.startsWith('ecount_purchasing_snapshot_')
  const isOutboundSource = source === 'ecount_purchasing_snapshot_outbound'

  if (isOutboundSource) {
    for (const componentMatchKey of purchaseRequestItemOutboundComponentMatchKeys(item.rawData)) {
      keys.push(purchasingOutboundComponentIdentity({
        source,
        sku: item.sku,
        purchaseManagementCode: item.purchaseManagementCode,
        componentMatchKey,
      }))
    }
  }

  // Strong purchase identifiers survive stage/source changes. Do not add an
  // order-wide key for outbound rows because one purchase may have several
  // independently managed split-shipment dates.
  if (isEcountSource && !isOutboundSource) {
    const orderIdentity = purchasingItemOrderIdentity(identityInput)
    if (orderIdentity) keys.push(orderIdentity)
  }

  // Purchase-history and China-arrival rows share the same durable bridge
  // fallback even when both order identifiers are absent. Save its sibling
  // source alias so a partial raw-data refresh cannot revive the other stage.
  if (!purchasingItemOrderIdentity(identityInput)) {
    const siblingSource = source === 'ecount_purchasing_snapshot_purchase_completed'
      ? 'ecount_purchasing_snapshot_china_arrived'
      : source === 'ecount_purchasing_snapshot_china_arrived'
        ? 'ecount_purchasing_snapshot_purchase_completed'
        : null
    if (siblingSource) keys.push(purchasingItemIdentity({ ...identityInput, source: siblingSource }))
  }

  return [...new Set(keys)]
}

function purchaseRequestItemOutboundComponentMatchKeys(rawData: Record<string, unknown>) {
  const directKeys = Array.isArray(rawData.componentMatchKeys)
    ? rawData.componentMatchKeys
    : []
  const componentKeys = Array.isArray(rawData.outboundComponents)
    ? rawData.outboundComponents.map((component) => (
      component && typeof component === 'object' && 'matchKey' in component
        ? component.matchKey
        : null
    ))
    : []
  return [...new Set([...directKeys, ...componentKeys]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim()))]
}

function purchaseRequestItemFallbackDiscriminator(rawData: Record<string, unknown>) {
  for (const key of ['purchaseHistoryBridgeKey', 'fallbackMatchKey']) {
    const value = rawData[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const sourceDateNo = typeof rawData.sourceDateNo === 'string' ? rawData.sourceDateNo.trim() : ''
  const sourceRowNumber = Number(rawData.sourceRowNumber)
  return sourceDateNo && Number.isFinite(sourceRowNumber)
    ? `${sourceDateNo}|${Math.trunc(sourceRowNumber)}`
    : sourceDateNo
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

function usesSaasChinaInventory(rawData: Record<string, unknown>) {
  return rawData.saasChinaMode === true
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

function positiveOneDecimal(value: string | number | null) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric * 10) / 10) : 0
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: T[] }).rows
  }
  return []
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

