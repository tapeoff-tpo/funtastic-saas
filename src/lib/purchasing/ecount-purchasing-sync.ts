import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  chinaWarehouseInventory,
  purchaseRequestItems,
} from '@/lib/db/schema'
import {
  cleanupExpiredCompletedOutboundItems,
  getReflectedOutboundMatchKeys,
} from './reflected-outbound-items'
import { cleanupExpiredEcountPurchaseOrderRowsInTransaction } from './purchase-order-retention'
import {
  ensureIgnoredPurchasingItemsTable,
  getIgnoredPurchasingItemKeysInTransaction,
  isPurchasingItemIgnored,
  purchasingOutboundComponentIdentity,
} from './ignored-purchasing-items'
import { ensurePurchaseRequestManagementCodeSkuLookupIndex } from './purchase-request-item-index'
import { ensurePurchasePaymentTrackingSchema } from './purchase-payment-tracking'
import {
  ensurePurchaseFundLedgerSchema,
  reconcilePurchaseFundDebitsInTransaction,
} from './purchase-fund-ledger'
import {
  isUniqueSupplierOrderIdentifier,
  normalizeEcountSupplierOrderReference,
  normalizeSupplierOrderReference,
} from './supplier-order-reference'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'

export const ECOUNT_PURCHASING_LEGACY_SOURCE = 'ecount_purchasing_replacement'
export const ECOUNT_PENDING_REQUEST_SOURCE = 'ecount_purchasing_snapshot_request'
export const ECOUNT_REQUEST_COMPLETED_SOURCE = 'ecount_purchasing_snapshot_request_completed'
export const ECOUNT_PURCHASE_COMPLETED_SOURCE = 'ecount_purchasing_snapshot_purchase_completed'
export const ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE = 'ecount_purchasing_snapshot_plan_purchase_completed'
export const ECOUNT_CHINA_ARRIVED_SOURCE = 'ecount_purchasing_snapshot_china_arrived'
export const ECOUNT_OUTBOUND_SOURCE = 'ecount_purchasing_snapshot_outbound'
export const ECOUNT_OUTBOUND_COMPLETED_SOURCE = 'ecount_purchasing_snapshot_outbound_completed'

const REPLACEABLE_ECOUNT_SOURCES = [
  ECOUNT_PURCHASING_LEGACY_SOURCE,
  ECOUNT_PENDING_REQUEST_SOURCE,
  ECOUNT_REQUEST_COMPLETED_SOURCE,
  ECOUNT_PURCHASE_COMPLETED_SOURCE,
  ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE,
  ECOUNT_CHINA_ARRIVED_SOURCE,
  ECOUNT_OUTBOUND_SOURCE,
  ECOUNT_OUTBOUND_COMPLETED_SOURCE,
] as const

const CHINA_INVENTORY_FIXED_HEADERS = new Set([
  '품목코드',
  '품목명',
  '규격',
  '품목구분',
  '합계',
])

const REPORT_KINDS = [
  'purchaseRequest',
  'purchasePlan',
  'purchaseHistory',
  'chinaInventory',
  'chinaOutbound',
] as const

export type EcountReportKind = (typeof REPORT_KINDS)[number]
type EcountPurchaseCompletedSource =
  | typeof ECOUNT_REQUEST_COMPLETED_SOURCE
  | typeof ECOUNT_PURCHASE_COMPLETED_SOURCE
  | typeof ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE
type PurchaseRequestItemInsert = typeof purchaseRequestItems.$inferInsert
type PurchaseManagementSkuIdentity = {
  sku: string
  purchaseManagementCode: string | null
}

type ParsedReport = {
  kind: EcountReportKind
  fileName: string
  sheet: ExcelJS.Worksheet
  headerRowNumber: number
  columns: Map<string, number>
}

export type EcountPurchasingUpload = {
  fileName: string
  fileBuffer: ArrayBuffer
}

export type EcountPurchasingRawFileRows = {
  kind: EcountReportKind
  headers: string[]
  rows: Array<Record<string, string>>
}

export type EcountPendingRequest = {
  sourceFileName: string
  sourceRowNumber: number
  sourceDateNo: string
  requestDate: string | null
  sku: string
  productName: string
  optionName: string | null
  requestedQuantity: number
  chinaArrivalRequestDate: string | null
  purchaseManagementCode: string
  buyerName: string | null
}

export type EcountPurchaseCompletedItem = {
  source: EcountPurchaseCompletedSource
  sourceFileName: string
  sourceRowNumber: number
  sourceDateNo: string
  sourceRequestFileName: string | null
  sourceRequestRowNumber: number | null
  purchaseDate: string | null
  sku: string
  productName: string
  optionName: string | null
  quantity: number
  chinaArrivalRequestDate: string | null
  purchaseManagementCode: string | null
  purchaseOrderNumber: string | null
  supplierOrderNumber: string | null
  purchaseMethod: string | null
  unitPriceCny: number | null
  shippingFeeCny: number | null
}

/** A purchase-history row that has reached the China warehouse. */
export type EcountChinaArrivedItem = EcountPurchaseCompletedItem & {
  /**
   * Quantity that is newer than the latest China-inventory snapshot and has
   * not yet been matched to China outbound. It must remain in the purchase
   * recommendation pipeline until the next inventory snapshot catches up.
   */
  pendingChinaInventoryQuantity: number
}

export type EcountChinaInventoryItem = {
  sourceFileName: string
  sourceRowNumber: number
  sku: string
  productName: string
  optionName: string | null
  optionKey: string
  productType: string | null
  quantity: number
  warehouseQuantities: Record<string, number>
}

export type EcountOutboundPendingItem = {
  sourceFileName: string
  sourceRowNumber: number
  sourceDateNo: string
  effectiveDate: string
  sku: string
  productName: string
  optionName: string | null
  quantity: number
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
  outboundManagementCode: string | null
  fallbackMatchKey: string
  componentMatchKeys: string[]
  outboundComponents: Array<{
    matchKey: string
    legacyMatchKey: string
    legacyMatchKeys?: string[]
    sourceRowNumber: number
    sourceDateNo: string
    effectiveDate: string
    quantity: number
  }>
  cumulativeOutboundQuantity: number
  totalOutboundQuantity: number
  purchasedQuantity: number | null
  isFullyOutbound: boolean
}

export type EcountPurchasingSnapshot = {
  asOfDate: string
  /** Printed date from the China-inventory workbook, when it provides one. */
  chinaInventorySnapshotAsOfDate: string | null
  domesticInventoryReflectedThrough: string
  purchasePlanConfirmedSince: string
  files: Record<EcountReportKind, string>
  activeRequests: EcountPendingRequest[]
  purchaseCompleted: EcountPurchaseCompletedItem[]
  /**
   * Confirmed rows in 구매현황. Unlike 중국재고현황, this report keeps the
   * purchase/order identity needed by the China-arrival screen.
   */
  chinaArrived: EcountChinaArrivedItem[]
  chinaInventory: EcountChinaInventoryItem[]
  outboundCompleted: EcountOutboundPendingItem[]
  outboundPending: EcountOutboundPendingItem[]
  validation: {
    activeRequestRows: number
    activeRequestsMatchedToPlan: number
    activeRequestsMatchedToPurchase: number
    planRowsWithIdentifierMismatch: number
    outboundRowsWithSupplierOrder: number
    outboundRowsMatchedToPurchase: number
    outboundRowsWithIdentifierMismatch: number
    outboundRowsWithoutReliableSupplierOrder: number
  }
  warnings: string[]
}

const REPORT_DEFINITIONS: Array<{
  kind: EcountReportKind
  requiredHeaders: string[]
  alternateRequiredHeaders?: string[][]
}> = [
  {
    kind: 'purchaseRequest',
    requiredHeaders: ['품목코드', '구입관리코드', '진행상태', '사전포장여부코드'],
  },
  {
    kind: 'purchasePlan',
    requiredHeaders: ['입고창고명', '실 구매 수량(C)', '구입관리코드', '현재상태'],
    alternateRequiredHeaders: [[
      '일자-No.',
      '품목코드',
      '구입관리코드',
      '옵션명',
      '수량',
      '주문서번호',
      '구매진행여부',
      '발주요청일자no',
    ]],
  },
  {
    kind: 'purchaseHistory',
    requiredHeaders: ['발주서-no', '발주계획일자', '구입관리코드', '진행상태'],
  },
  {
    kind: 'chinaInventory',
    requiredHeaders: ['품목코드', '품목명', '품목구분', '합계'],
  },
  {
    kind: 'chinaOutbound',
    requiredHeaders: ['출고수량(EA)', '유효기간', '출고관리코드'],
  },
]

const REPORT_HEADER_ALIASES: Partial<Record<EcountReportKind, Partial<Record<string, string[]>>>> = {
  purchasePlan: {
    '실 구매 수량(C)': ['수량'],
    규격: ['옵션명'],
    '주문서번호 (C)': ['주문서번호'],
    '구매진행여부 (C)': ['구매진행여부'],
  },
}

function reportHeaderSignatures(definition: (typeof REPORT_DEFINITIONS)[number]) {
  return [definition.requiredHeaders, ...(definition.alternateRequiredHeaders ?? [])]
}

export async function parseEcountPurchasingSnapshot(input: {
  files: EcountPurchasingUpload[]
  domesticInventoryReflectedThrough: string
  asOfDate?: string
  purchasePlanConfirmedSince?: string
  allowMissingReports?: boolean
  purchaseHistoryBridgeKeys?: Iterable<string>
}): Promise<EcountPurchasingSnapshot> {
  const reflectedThrough = normalizeDateOnly(input.domesticInventoryReflectedThrough)
  if (!reflectedThrough) {
    throw new Error('국내재고 반영 기준일을 YYYY-MM-DD 형식으로 입력해주세요.')
  }
  const asOfDate = normalizeDateOnly(input.asOfDate ?? formatDate(new Date()))
  if (!asOfDate) throw new Error('Ecount 기준일을 YYYY-MM-DD 형식으로 입력해주세요.')
  const purchasePlanConfirmedSince = normalizeDateOnly(
    input.purchasePlanConfirmedSince ?? `${asOfDate.slice(0, 7)}-01`,
  )
  if (!purchasePlanConfirmedSince) {
    throw new Error('완료 발주계획 반영 시작일을 YYYY-MM-DD 형식으로 입력해주세요.')
  }

  const reports = await Promise.all(input.files.map(loadEcountReport))
  const reportByKind = new Map<EcountReportKind, ParsedReport>()
  for (const report of reports) {
    if (reportByKind.has(report.kind)) {
      throw new Error(`${reportLabel(report.kind)} 파일이 두 개 이상입니다. 원본 파일은 종류별로 하나씩 선택해주세요.`)
    }
    reportByKind.set(report.kind, report)
  }

  const missingKinds = REPORT_KINDS.filter((kind) => !reportByKind.has(kind))
  if (missingKinds.length > 0 && !input.allowMissingReports) {
    throw new Error(`필수 원본 파일이 없습니다: ${missingKinds.map(reportLabel).join(', ')}`)
  }
  for (const kind of missingKinds) reportByKind.set(kind, emptyReport(kind))

  const purchaseRequest = reportByKind.get('purchaseRequest')!
  const purchasePlan = reportByKind.get('purchasePlan')!
  const purchaseHistory = reportByKind.get('purchaseHistory')!
  const chinaInventory = reportByKind.get('chinaInventory')!
  const chinaOutbound = reportByKind.get('chinaOutbound')!
  const chinaInventorySnapshotAsOfDate = readChinaInventorySnapshotAsOfDate(chinaInventory)

  // 발주계획 조회에는 과거 종결/취소 건도 함께 내려올 수 있다. 이 파일은
  // 현재 구매 진행분만 나타내야 하므로 종결 행은 발주 파이프라인에 넣지 않는다.
  const purchasePlanRows = readRows(purchasePlan)
    .filter((row) => isPurchaseItemSku(valueAt(row, purchasePlan, '품목코드')))
    .filter((row) => !isTerminalPurchasePlanRow(row, purchasePlan))
  const planRowsByPurchaseKey = new Map<string, Array<{ number: number; row: ExcelJS.Row }>>()
  for (const row of purchasePlanRows) {
    const key = purchaseKey(
      valueAt(row, purchasePlan, '구입관리코드'),
      valueAt(row, purchasePlan, '품목코드'),
    )
    if (!key) continue
    const matches = planRowsByPurchaseKey.get(key) ?? []
    matches.push(row)
    planRowsByPurchaseKey.set(key, matches)
  }
  const planKeys = new Set(planRowsByPurchaseKey.keys())
  const purchaseKeys = new Set(readRows(purchaseHistory)
    .filter((row) => isPurchaseItemSku(valueAt(row, purchaseHistory, '품목코드')))
    .map((row) => purchaseKey(
      valueAt(row, purchaseHistory, '구입관리코드'),
      valueAt(row, purchaseHistory, '품목코드'),
    ))
    .filter((key) => key !== null))
  const purchaseSupplierKeys = new Set(readRows(purchaseHistory)
    .filter((row) => isPurchaseItemSku(valueAt(row, purchaseHistory, '품목코드')))
    .map((row) => supplierKey(
      valueAt(row, purchaseHistory, '주문서번호 (C)'),
      valueAt(row, purchaseHistory, '품목코드'),
    ))
    .filter((key) => key !== null))

  let activeRequests = readRows(purchaseRequest)
    .filter((row) => isPurchaseItemSku(valueAt(row, purchaseRequest, '품목코드')))
    .filter((row) => valueAt(row, purchaseRequest, '진행상태') === '진행중')
    .map<EcountPendingRequest | null>((row) => {
      const sku = valueAt(row, purchaseRequest, '품목코드')
      const purchaseManagementCode = valueAt(row, purchaseRequest, '구입관리코드')
      const requestedQuantity = positiveInteger(valueAt(row, purchaseRequest, '구매수량(EA)'))
      if (!purchaseManagementCode || requestedQuantity === 0) return null

      return {
        sourceFileName: purchaseRequest.fileName,
        sourceRowNumber: row.number,
        sourceDateNo: valueAt(row, purchaseRequest, '일자-No.'),
        requestDate: parseDate(valueAt(row, purchaseRequest, '일자-No.')),
        sku,
        productName: valueAt(row, purchaseRequest, '품목명'),
        optionName: emptyToNull(valueAt(row, purchaseRequest, '규격')),
        requestedQuantity,
        chinaArrivalRequestDate: parseDate(valueAt(row, purchaseRequest, '중국창고 도착요청일')),
        purchaseManagementCode,
        buyerName: emptyToNull(valueAt(row, purchaseRequest, '사원(담당)명')),
      } satisfies EcountPendingRequest
    })
    .filter((row): row is EcountPendingRequest => row !== null)

  const chinaInventoryWarehouseHeaders = [...chinaInventory.columns.entries()]
    .filter(([header]) => !CHINA_INVENTORY_FIXED_HEADERS.has(header))
    .sort(([, leftColumn], [, rightColumn]) => leftColumn - rightColumn)
    .map(([header]) => header)
  const chinaInventoryItems = readRows(chinaInventory)
    .map<EcountChinaInventoryItem | null>((row) => {
      const sku = valueAt(row, chinaInventory, '품목코드')
      const productName = valueAt(row, chinaInventory, '품목명')
      const quantity = positiveInteger(valueAt(row, chinaInventory, '합계'))
      const optionName = emptyToNull(valueAt(row, chinaInventory, '규격'))
      if (!sku || !productName) return null
      const warehouseQuantities = Object.fromEntries(
        chinaInventoryWarehouseHeaders.map((header) => [
          header,
          positiveInteger(valueAt(row, chinaInventory, header)),
        ]),
      )

      return {
        sourceFileName: chinaInventory.fileName,
        sourceRowNumber: row.number,
        sku,
        productName,
        optionName,
        optionKey: optionName ?? '',
        productType: emptyToNull(valueAt(row, chinaInventory, '품목구분')),
        quantity,
        warehouseQuantities,
      }
    })
    .filter((row): row is EcountChinaInventoryItem => row !== null)

  const rawChinaOutboundItems = assignStableOutboundFallbackKeys(
    readRows(chinaOutbound)
      .filter((row) => isPurchaseItemSku(valueAt(row, chinaOutbound, '품목코드')))
      .map<EcountOutboundPendingItem | null>((row) => {
      const effectiveDate = parseDate(valueAt(row, chinaOutbound, '유효기간'))
      const quantity = positiveInteger(valueAt(row, chinaOutbound, '출고수량(EA)'))
      if (!effectiveDate || quantity === 0) return null

      const sku = valueAt(row, chinaOutbound, '품목코드')
      const sourceDateNo = valueAt(row, chinaOutbound, '일자-No.')
      const purchaseManagementCode = emptyToNull(valueAt(row, chinaOutbound, '구입관리코드'))
      const outboundManagementCode = emptyToNull(valueAt(row, chinaOutbound, '출고관리코드'))
      const supplierOrderNumber = normalizeEcountSupplierOrderReference(
        valueAt(row, chinaOutbound, '주문서번호'),
      )
      const uniqueSupplierOrderNumber = reliableSupplierOrderNumber(supplierOrderNumber ?? '')
      const supplierLegacyMatchKey = uniqueSupplierOrderNumber
        ? `supplier:${uniqueSupplierOrderNumber}:${sku}`
        : ''
      const rowLegacyMatchKey = `row:${sourceDateNo}:${sku}:${row.number}`
      const fallbackMatchKey = outboundManagementCode
        ? `outbound:${outboundManagementCode}:${sku}`
        : rowLegacyMatchKey
      const legacyMatchKeys = [rowLegacyMatchKey, supplierLegacyMatchKey].filter(Boolean)

      return {
        sourceFileName: chinaOutbound.fileName,
        sourceRowNumber: row.number,
        sourceDateNo,
        effectiveDate,
        sku,
        productName: valueAt(row, chinaOutbound, '품목명'),
        optionName: emptyToNull(valueAt(row, chinaOutbound, '규격')),
        quantity,
        purchaseManagementCode,
        supplierOrderNumber,
        outboundManagementCode,
        fallbackMatchKey,
        componentMatchKeys: [fallbackMatchKey],
        outboundComponents: [{
          matchKey: fallbackMatchKey,
          legacyMatchKey: legacyMatchKeys[0] ?? '',
          legacyMatchKeys,
          sourceRowNumber: row.number,
          sourceDateNo,
          effectiveDate,
          quantity,
        }],
        cumulativeOutboundQuantity: quantity,
        totalOutboundQuantity: quantity,
        purchasedQuantity: null,
        isFullyOutbound: false,
      } satisfies EcountOutboundPendingItem
      })
      .filter((row): row is EcountOutboundPendingItem => row !== null),
  )

  // Plans are the purchase-in-progress stage. Purchase history consumes plan
  // quantities that have already reached China. Identifiers improve matching,
  // but missing management/order numbers never cause a row to be dropped.
  const requestRowsByPurchaseKey = new Map<string, Array<{ number: number; row: ExcelJS.Row }>>()
  for (const request of readRows(purchaseRequest)) {
    const key = purchaseKey(
      valueAt(request, purchaseRequest, '구입관리코드'),
      valueAt(request, purchaseRequest, '품목코드'),
    )
    if (!key) continue
    const matches = requestRowsByPurchaseKey.get(key) ?? []
    matches.push(request)
    requestRowsByPurchaseKey.set(key, matches)
  }
  const planItems = purchasePlanRows
    .map<EcountPurchaseCompletedItem | null>((plan) => {
      const sku = valueAt(plan, purchasePlan, '품목코드')
      const quantity = positiveInteger(valueAt(plan, purchasePlan, '실 구매 수량(C)'))
      if (!isPurchaseItemSku(sku) || quantity === 0) return null
      const purchaseManagementCode = emptyToNull(valueAt(plan, purchasePlan, '구입관리코드'))
      const requestMatches = purchaseManagementCode
        ? requestRowsByPurchaseKey.get(purchaseKey(purchaseManagementCode, sku)!) ?? []
        : []
      const request = requestMatches.length === 1 ? requestMatches[0] : null

      return {
        source: ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE,
        sourceFileName: purchasePlan.fileName,
        sourceRowNumber: plan.number,
        sourceDateNo: valueAt(plan, purchasePlan, '일자-No.'),
        sourceRequestFileName: request ? purchaseRequest.fileName : null,
        sourceRequestRowNumber: request?.number ?? null,
        purchaseDate: parseDate(valueAt(plan, purchasePlan, '일자-No.')),
        sku,
        productName: valueAt(plan, purchasePlan, '품목명'),
        optionName: emptyToNull(valueAt(plan, purchasePlan, '규격')),
        quantity,
        chinaArrivalRequestDate: request
          ? parseDate(valueAt(request, purchaseRequest, '중국창고 도착요청일'))
          : null,
        purchaseManagementCode,
        purchaseOrderNumber: null,
        supplierOrderNumber: normalizeEcountSupplierOrderReference(
          valueAt(plan, purchasePlan, '주문서번호 (C)'),
        ),
        purchaseMethod: emptyToNull(valueAt(plan, purchasePlan, '구매진행여부 (C)')),
        unitPriceCny: null,
        shippingFeeCny: null,
      }
    })
    .filter((row): row is EcountPurchaseCompletedItem => row !== null)
  const completedRequestItems = readRows(purchaseRequest)
    .filter((row) => isPurchaseItemSku(valueAt(row, purchaseRequest, '품목코드')))
    .filter((row) => valueAt(row, purchaseRequest, '진행상태') === '완료')
    .map<EcountPurchaseCompletedItem | null>((request) => {
      const sku = valueAt(request, purchaseRequest, '품목코드')
      const quantity = positiveInteger(valueAt(request, purchaseRequest, '구매수량(EA)'))
      if (quantity === 0) return null
      return {
        source: ECOUNT_REQUEST_COMPLETED_SOURCE,
        sourceFileName: purchaseRequest.fileName,
        sourceRowNumber: request.number,
        sourceDateNo: valueAt(request, purchaseRequest, '일자-No.'),
        sourceRequestFileName: purchaseRequest.fileName,
        sourceRequestRowNumber: request.number,
        purchaseDate: parseDate(valueAt(request, purchaseRequest, '일자-No.')),
        sku,
        productName: valueAt(request, purchaseRequest, '품목명'),
        optionName: emptyToNull(valueAt(request, purchaseRequest, '규격')),
        quantity,
        chinaArrivalRequestDate: parseDate(valueAt(request, purchaseRequest, '중국창고 도착요청일')),
        purchaseManagementCode: emptyToNull(valueAt(request, purchaseRequest, '구입관리코드')),
        purchaseOrderNumber: null,
        supplierOrderNumber: null,
        purchaseMethod: null,
        unitPriceCny: null,
        shippingFeeCny: null,
      }
    })
    .filter((row): row is EcountPurchaseCompletedItem => row !== null)
  const uniqueCompletedRequestItems = deduplicateCompletedRequests(completedRequestItems)
  activeRequests = activeRequests.filter((request) => (
    !uniqueCompletedRequestItems.some((progressed) => pendingRequestMatchesProgressed(request, progressed))
    && !planItems.some((progressed) => pendingRequestMatchesProgressed(request, progressed))
  ))
  const unplannedCompletedRequests = uniqueCompletedRequestItems.filter((request) => (
    !planItems.some((plan) => (
      sameManagedSku(request, plan) || pipelineMatchScore(request, plan) > 0
    ))
  ))
  const historyItems = readRows(purchaseHistory)
    .filter((row) => isPurchaseItemSku(valueAt(row, purchaseHistory, '품목코드')))
    .filter((row) => valueAt(row, purchaseHistory, '진행상태') === '확인')
    .map<EcountPurchaseCompletedItem | null>((row) => {
      const sku = valueAt(row, purchaseHistory, '품목코드')
      const sourceQuantity = positiveInteger(valueAt(row, purchaseHistory, '구매수량(EA)'))
      const purchaseManagementCode = emptyToNull(valueAt(row, purchaseHistory, '구입관리코드'))
      const chinaArrivalRequestDate = parseDate(valueAt(row, purchaseHistory, '중국창고 도착요청일'))
      if (sourceQuantity === 0) return null

      const supplierOrderNumber = normalizeEcountSupplierOrderReference(
        valueAt(row, purchaseHistory, '주문서번호 (C)'),
      )
      return {
        source: ECOUNT_PURCHASE_COMPLETED_SOURCE,
        sourceFileName: purchaseHistory.fileName,
        sourceRowNumber: row.number,
        sourceDateNo: valueAt(row, purchaseHistory, '일자-No.'),
        sourceRequestFileName: null,
        sourceRequestRowNumber: null,
        purchaseDate: parseDate(valueAt(row, purchaseHistory, '일자-No.')),
        sku,
        productName: valueAt(row, purchaseHistory, '품목명'),
        optionName: emptyToNull(valueAt(row, purchaseHistory, '규격')),
        quantity: sourceQuantity,
        chinaArrivalRequestDate,
        purchaseManagementCode,
        purchaseOrderNumber: emptyToNull(valueAt(row, purchaseHistory, '발주서-no')),
        supplierOrderNumber,
        purchaseMethod: emptyToNull(valueAt(row, purchaseHistory, '창고명')),
        unitPriceCny: null,
        shippingFeeCny: null,
      }
    })
    .filter((row): row is EcountPurchaseCompletedItem => row !== null)
  const purchaseCompletedFromPlan = reconcilePlanWithPurchaseHistory(
    [...planItems, ...unplannedCompletedRequests],
    historyItems,
  )
  const purchaseHistoryBridgeKeys = new Set(input.purchaseHistoryBridgeKeys ?? [])
  // China-arrival is an order-level current state. Subtract outbound quantities
  // by strong identifiers first. Reports without a purchase-management code or
  // unique supplier order then use a SKU/date FIFO bridge, because cells
  // such as "웨이신" identify a payment channel rather than one global order.
  const historyRemainingAfterOutbound = remainingPurchaseHistoryBridgeItems(
    historyItems,
    rawChinaOutboundItems,
  )
  // China inventory is an aggregate current-state snapshot rather than an
  // order-level report. Attribute that stock to the newest eligible arrivals,
  // so older purchase-history rows disappear first. Purchases newer than the
  // printed snapshot date are deliberately protected: that inventory file
  // could not have included them yet.
  const chinaInventoryReconciliation = reconcilePurchaseHistoryWithChinaInventory(
    historyRemainingAfterOutbound,
    chinaInventoryItems,
    chinaInventory.fileName ? chinaInventorySnapshotAsOfDate : null,
    reflectedThrough,
  )
  const outstandingChinaArrivals = chinaInventoryReconciliation.items
  // 구매현황 is the source of the China-arrival stage. A recent arrival can be
  // newer than the latest China-inventory snapshot, so retain just its
  // globally unmatched quantity as a pipeline marker on the same
  // China-arrival row. The marker must share the same outbound allocation as
  // the stage itself, otherwise an outbound can be subtracted twice.
  // Do not create a second purchase_completed row: that would both duplicate
  // the order in the UI and collide with the management-code/SKU unique key.
  const chinaArrived: EcountChinaArrivedItem[] = outstandingChinaArrivals.map((item) => ({
    ...item,
    pendingChinaInventoryQuantity: (() => {
      const historyKey = getPurchaseHistoryBridgeKey(item)
      if (chinaInventoryReconciliation.pendingQuantityByHistoryKey.has(historyKey)) {
        return chinaInventoryReconciliation.pendingQuantityByHistoryKey.get(historyKey) ?? 0
      }
      const arrivedAfterInventorySnapshot = Boolean(
        item.purchaseDate
        && chinaInventorySnapshotAsOfDate
        && item.purchaseDate > chinaInventorySnapshotAsOfDate,
      )
      // A history row newer than the inventory snapshot cannot be represented
      // by that snapshot, even when its only order reference is a reusable
      // payment-channel label such as "웨이신". Older weak rows still require a
      // reliable order identity before a carried bridge can affect purchasing.
      return arrivedAfterInventorySnapshot
        || (purchaseHistoryBridgeKeys.has(historyKey) && hasReliablePurchaseIdentity(item))
        ? item.quantity
        : 0
    })(),
  }))
  const purchaseCompleted = purchaseCompletedFromPlan

  // Split shipments remain distinct by outbound date so date-based inventory
  // reflection stays exact. Rows from the same supplier order + SKU + date are
  // aggregated, while cumulative progress is calculated across every date.
  const outboundCompleted = aggregateChinaOutboundItems(
    rawChinaOutboundItems.filter((row) => row.effectiveDate <= asOfDate),
    rawChinaOutboundItems,
    historyItems,
  )
  const outboundPending = aggregateChinaOutboundItems(
    rawChinaOutboundItems.filter((row) => row.effectiveDate > asOfDate),
    rawChinaOutboundItems,
    historyItems,
  )

  const activeRequestsMatchedToPlan = activeRequests.filter((row) => planKeys.has(
    purchaseKey(row.purchaseManagementCode, row.sku)!,
  )).length
  const activeRequestsMatchedToPurchase = activeRequests.filter((row) => purchaseKeys.has(
    purchaseKey(row.purchaseManagementCode, row.sku)!,
  )).length
  const planRowsWithIdentifierMismatch = planItems.filter((plan) => (
    hasManagementGroupSupplierMismatch(plan, historyItems)
  )).length
  const outboundRowsWithSupplierOrder = rawChinaOutboundItems.filter((row) => (
    supplierKey(row.supplierOrderNumber, row.sku) !== null
  ))
  const outboundRowsWithPurchaseReference = rawChinaOutboundItems.filter((row) => (
    row.purchaseManagementCode !== null || supplierKey(row.supplierOrderNumber, row.sku) !== null
  ))
  const outboundRowsMatchedToPurchase = outboundRowsWithPurchaseReference.filter((row) => {
    const managementKey = row.purchaseManagementCode
      ? purchaseKey(row.purchaseManagementCode, row.sku)
      : null
    if (managementKey) return purchaseKeys.has(managementKey)
    return purchaseSupplierKeys.has(supplierKey(row.supplierOrderNumber, row.sku)!)
  }).length
  const outboundRowsWithIdentifierMismatch = rawChinaOutboundItems.filter((outbound) => (
    hasManagementGroupSupplierMismatch(outbound, historyItems)
  )).length
  const outboundRowsWithoutReliableSupplierOrder = rawChinaOutboundItems.length - outboundRowsWithSupplierOrder.length
  const outboundRowsWithoutPurchaseReference = rawChinaOutboundItems.length - outboundRowsWithPurchaseReference.length

  const warnings: string[] = []
  if (activeRequests.length === 0) warnings.push('진행중 발주요청이 없습니다.')
  if (chinaInventoryItems.length === 0) warnings.push('중국창고 재고가 0건입니다.')
  if (outboundRowsWithoutPurchaseReference > 0) {
    warnings.push(`중국출고 ${outboundRowsWithoutPurchaseReference.toLocaleString('ko-KR')}건은 강한 주문 추적키가 없어 동일 품목코드와 출고일 기준 FIFO로 구매현황에 보조 연결합니다.`)
  }
  if (outboundRowsWithPurchaseReference.length !== outboundRowsMatchedToPurchase) {
    warnings.push(`중국출고 구매 대조 ${outboundRowsMatchedToPurchase.toLocaleString('ko-KR')}/${outboundRowsWithPurchaseReference.length.toLocaleString('ko-KR')}건이 구매현황과 일치합니다.`)
  }
  if (planRowsWithIdentifierMismatch > 0) {
    warnings.push(`발주계획 ${planRowsWithIdentifierMismatch.toLocaleString('ko-KR')}건은 구입관리코드는 구매현황과 일치하지만 주문서번호가 다릅니다. 구입관리코드 기준으로 연결했으니 원본을 확인해주세요.`)
  }
  if (outboundRowsWithIdentifierMismatch > 0) {
    warnings.push(`중국출고 ${outboundRowsWithIdentifierMismatch.toLocaleString('ko-KR')}건은 구입관리코드는 구매현황과 일치하지만 주문서번호가 다릅니다. 구입관리코드 기준으로 연결했으니 원본을 확인해주세요.`)
  }

  return {
    asOfDate,
    chinaInventorySnapshotAsOfDate,
    domesticInventoryReflectedThrough: reflectedThrough,
    purchasePlanConfirmedSince,
    files: {
      purchaseRequest: purchaseRequest.fileName,
      purchasePlan: purchasePlan.fileName,
      purchaseHistory: purchaseHistory.fileName,
      chinaInventory: chinaInventory.fileName,
      chinaOutbound: chinaOutbound.fileName,
    },
    activeRequests,
    purchaseCompleted,
    chinaArrived,
    chinaInventory: chinaInventoryItems,
    outboundCompleted,
    outboundPending,
    validation: {
      activeRequestRows: activeRequests.length,
      activeRequestsMatchedToPlan,
      activeRequestsMatchedToPurchase,
      planRowsWithIdentifierMismatch,
      outboundRowsWithSupplierOrder: outboundRowsWithSupplierOrder.length,
      outboundRowsMatchedToPurchase,
      outboundRowsWithIdentifierMismatch,
      outboundRowsWithoutReliableSupplierOrder,
    },
    warnings,
  }
}

function assignStableOutboundFallbackKeys(items: EcountOutboundPendingItem[]) {
  const occurrences = new Map<string, number>()
  return items.map((item) => {
    if (item.outboundManagementCode) return item

    // Ecount row numbers change when users export only a new date range.
    const identity = [
      item.sourceDateNo.replace(/\s+/g, ''),
      item.sku,
      (item.optionName ?? '').replace(/\s+/g, ' '),
      item.effectiveDate,
      item.quantity,
      ...(item.purchaseManagementCode ? [item.purchaseManagementCode] : []),
    ].join('\u001f')
    const occurrence = (occurrences.get(identity) ?? 0) + 1
    occurrences.set(identity, occurrence)
    const matchKey = `outbound-row:${createHash('sha256').update(`${identity}\u001f${occurrence}`).digest('hex')}`
    const component = item.outboundComponents[0]
    const legacyMatchKeys = [...new Set([
      item.fallbackMatchKey,
      ...outboundComponentLegacyMatchKeys(component),
    ].filter(Boolean))]

    return {
      ...item,
      fallbackMatchKey: matchKey,
      componentMatchKeys: [matchKey],
      outboundComponents: [{
        ...component,
        matchKey,
        legacyMatchKey: legacyMatchKeys[0] ?? '',
        legacyMatchKeys,
      }],
    }
  })
}

function deduplicateCompletedRequests(items: EcountPurchaseCompletedItem[]) {
  const keyed = new Map<string, EcountPurchaseCompletedItem>()
  const unkeyed: EcountPurchaseCompletedItem[] = []
  for (const item of items) {
    const key = purchaseKey(item.purchaseManagementCode ?? '', item.sku)
    if (!key) {
      unkeyed.push(item)
      continue
    }
    const existing = keyed.get(key)
    if (!existing || item.sourceRowNumber > existing.sourceRowNumber) keyed.set(key, item)
  }
  return [...keyed.values(), ...unkeyed]
}

function isTerminalPurchasePlanRow(
  row: { row: ExcelJS.Row },
  purchasePlan: ParsedReport,
) {
  return ['종결여부', '현재상태'].some((header) => {
    const status = valueAt(row, purchasePlan, header).replace(/\s+/g, '')
    return status === '종결'
      || status === '취소'
      || status === '삭제'
      || status === '종료'
      || status.startsWith('종결처리')
      || status.startsWith('취소처리')
  })
}

function emptyReport(kind: EcountReportKind): ParsedReport {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('empty')
  const definition = REPORT_DEFINITIONS.find((item) => item.kind === kind)!
  return {
    kind,
    fileName: '',
    sheet,
    headerRowNumber: 1,
    columns: new Map(definition.requiredHeaders.map((header, index) => [header, index + 1])),
  }
}

export async function classifyEcountPurchasingUpload(input: EcountPurchasingUpload) {
  const report = await loadEcountReport(input)
  return { kind: report.kind, fileName: report.fileName }
}

/**
 * Reads only real item rows from an Ecount report so historical files can be
 * accumulated without carrying forward subtotal and print-footer rows.
 */
export async function readEcountPurchasingRawFileRows(
  input: EcountPurchasingUpload,
): Promise<EcountPurchasingRawFileRows> {
  const report = await loadEcountReport(input)
  const headers = [...report.columns.entries()]
    .sort(([, leftColumn], [, rightColumn]) => leftColumn - rightColumn)
    .map(([header]) => header)
  const rows = readRows(report)
    .filter(({ row }) => valueAt({ row }, report, '품목코드') !== '')
    .map(({ row }) => Object.fromEntries(headers.map((header) => [
      header,
      valueAt({ row }, report, header),
    ])))

  return { kind: report.kind, headers, rows }
}

export function getEcountReportLabel(kind: EcountReportKind) {
  return reportLabel(kind)
}

/** Reads the date printed in the Chinese-inventory report header, if present. */
export async function getEcountChinaInventorySnapshotDate(
  input: EcountPurchasingUpload,
) {
  const report = await loadEcountReport(input)
  return readChinaInventorySnapshotAsOfDate(report)
}

function readChinaInventorySnapshotAsOfDate(report: ParsedReport) {
  if (report.kind !== 'chinaInventory') return null
  let snapshotDate: string | null = null
  for (let rowNumber = 1; rowNumber < report.headerRowNumber; rowNumber += 1) {
    report.sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
      const candidate = parseDate(cellText(cell.value))
      if (candidate && (!snapshotDate || candidate > snapshotDate)) snapshotDate = candidate
    })
  }
  return snapshotDate
}

export function getPurchaseHistoryBridgeKey(input: {
  sourceDateNo: string
  sku: string
  optionName: string | null
  purchaseManagementCode: string | null
  purchaseOrderNumber?: string | null
  supplierOrderNumber: string | null
}) {
  return [
    input.sourceDateNo,
    input.sku,
    input.optionName ?? '',
    input.purchaseManagementCode ?? '',
    input.purchaseOrderNumber ?? '',
    reliableSupplierOrderNumber(input.supplierOrderNumber ?? '') ?? '',
  ].map((value) => value.trim()).join('\u001f')
}

export function getPurchaseHistoryBridgeKeyFromRawRow(row: Record<string, string>) {
  return getPurchaseHistoryBridgeKey({
    sourceDateNo: row['일자-No.'] ?? '',
    sku: row['품목코드'] ?? '',
    optionName: row['규격'] || null,
    purchaseManagementCode: row['구입관리코드'] || null,
    purchaseOrderNumber: row['발주서-no'] || null,
    supplierOrderNumber: row['주문서번호 (C)'] || null,
  })
}

export function getPurchaseHistoryBridgeKeysAfterChinaInventorySnapshot(
  rows: Array<Record<string, string>>,
  inventorySnapshotDate: string | null,
) {
  if (!inventorySnapshotDate) return []
  return rows.flatMap((row) => {
    const historyDate = parseDate(row['일자-No.'] ?? '')
    if (row['진행상태'] !== '확인' || !historyDate || historyDate <= inventorySnapshotDate) return []
    return [getPurchaseHistoryBridgeKeyFromRawRow(row)]
  })
}

function pendingRequestMatchesProgressed(
  request: EcountPendingRequest,
  progressed: EcountPurchaseCompletedItem,
) {
  if (request.sku !== progressed.sku) return false
  if (request.purchaseManagementCode && progressed.purchaseManagementCode) {
    return request.purchaseManagementCode === progressed.purchaseManagementCode
  }
  const requestOption = request.optionName?.trim() ?? ''
  const progressedOption = progressed.optionName?.trim() ?? ''
  if (requestOption && progressedOption && requestOption !== progressedOption) return false
  return true
}

function sameManagedSku(
  left: EcountPurchaseCompletedItem,
  right: EcountPurchaseCompletedItem,
) {
  return Boolean(
    left.purchaseManagementCode
    && right.purchaseManagementCode
    && left.purchaseManagementCode === right.purchaseManagementCode
    && left.sku === right.sku,
  )
}

function hasReliablePurchaseIdentity(item: EcountPurchaseCompletedItem) {
  return Boolean(item.purchaseManagementCode || supplierKey(item.supplierOrderNumber, item.sku))
}

type PurchasingMatchItem = Pick<
  EcountPurchaseCompletedItem,
  'sku' | 'purchaseManagementCode' | 'supplierOrderNumber'
>

function purchaseManagementMatch(
  left: PurchasingMatchItem,
  right: PurchasingMatchItem,
) {
  return Boolean(
    left.sku === right.sku
    && left.purchaseManagementCode
    && right.purchaseManagementCode
    && left.purchaseManagementCode === right.purchaseManagementCode,
  )
}

function purchasingItemsMatch(
  left: PurchasingMatchItem,
  right: PurchasingMatchItem,
) {
  if (left.sku !== right.sku) return false
  const hasManagementKeyOnBothSides = Boolean(
    left.purchaseManagementCode && right.purchaseManagementCode,
  )
  if (hasManagementKeyOnBothSides) return purchaseManagementMatch(left, right)

  // Supplier order + SKU is only a fallback when the management key cannot be
  // used on both records. Some supplier-order cells are memo text, so this
  // path deliberately requires a validated order number on each side.
  const leftSupplierOrderKey = supplierKey(left.supplierOrderNumber, left.sku)
  const rightSupplierOrderKey = supplierKey(right.supplierOrderNumber, right.sku)
  return Boolean(leftSupplierOrderKey && rightSupplierOrderKey && leftSupplierOrderKey === rightSupplierOrderKey)
}

function hasManagementGroupSupplierMismatch(
  item: PurchasingMatchItem,
  counterparts: PurchasingMatchItem[],
) {
  const supplierOrderKey = supplierKey(item.supplierOrderNumber, item.sku)
  if (!supplierOrderKey) return false

  const matchingSupplierOrderKeys = counterparts
    .filter((counterpart) => purchaseManagementMatch(item, counterpart))
    .map((counterpart) => supplierKey(counterpart.supplierOrderNumber, counterpart.sku))
    .filter((key): key is string => key !== null)

  // Multiple supplier orders may legitimately exist within the same management
  // code + SKU group. Only warn when that group has a reliable supplier-order
  // value, but none agrees with the row being reconciled.
  return matchingSupplierOrderKeys.length > 0 && !matchingSupplierOrderKeys.includes(supplierOrderKey)
}

function purchaseHistoryMatchesChinaOutbound(
  purchase: EcountPurchaseCompletedItem,
  outbound: EcountOutboundPendingItem,
) {
  return purchasingItemsMatch(purchase, outbound)
}

function remainingPurchaseHistoryBridgeItems(
  historyItems: EcountPurchaseCompletedItem[],
  outboundItems: EcountOutboundPendingItem[],
) {
  const remainingHistoryItems = historyItems
    .map((item, index) => ({ item, index, remainingQuantity: item.quantity }))
    .sort((left, right) => (
      (left.item.purchaseDate ?? '9999-12-31').localeCompare(right.item.purchaseDate ?? '9999-12-31')
      || left.item.sourceRowNumber - right.item.sourceRowNumber
      || left.index - right.index
    ))

  // Allocate every physical outbound row once. Strong references are processed
  // globally before a weak FIFO row, otherwise an earlier unkeyed outbound could
  // consume the purchase reserved for a later, explicitly identified shipment.
  const orderedOutboundItems = [...outboundItems]
    .map((item, index) => ({ item, index, remainingQuantity: item.quantity }))
    .sort((left, right) => (
      left.item.effectiveDate.localeCompare(right.item.effectiveDate)
      || left.item.sourceRowNumber - right.item.sourceRowNumber
      || left.index - right.index
    ))

  const allocateOutbound = (
    predicate: (outbound: EcountOutboundPendingItem) => boolean,
    matches: (
      history: EcountPurchaseCompletedItem,
      outbound: EcountOutboundPendingItem,
    ) => boolean,
  ) => {
    for (const outbound of orderedOutboundItems) {
      if (!predicate(outbound.item)) continue
      for (const history of remainingHistoryItems) {
        if (outbound.remainingQuantity === 0) break
        if (
          history.remainingQuantity === 0
          || !purchaseHistoryCanUseStrongOutboundMatch(history.item, outbound.item)
          || !matches(history.item, outbound.item)
        ) {
          continue
        }
        const consumed = Math.min(history.remainingQuantity, outbound.remainingQuantity)
        history.remainingQuantity -= consumed
        outbound.remainingQuantity -= consumed
      }
    }
  }

  // A purchase-management code names the workflow row directly. Reserve those
  // matches before a supplier-order-only row, since one supplier order number
  // can legitimately be reused across multiple management-code groups.
  allocateOutbound(
    (outbound) => Boolean(outbound.purchaseManagementCode),
    purchaseManagementMatch,
  )
  allocateOutbound(
    (outbound) => supplierKey(outbound.supplierOrderNumber, outbound.sku) !== null,
    purchaseHistoryMatchesChinaOutbound,
  )

  for (const outbound of orderedOutboundItems) {
    if (
      outbound.remainingQuantity === 0
      || outbound.item.purchaseManagementCode
      || supplierKey(outbound.item.supplierOrderNumber, outbound.item.sku)
    ) continue

    const candidates = remainingHistoryItems
      .filter((history) => (
        history.remainingQuantity > 0
        && purchaseHistoryCanUseOutboundFifo(history.item, outbound.item)
      ))
      .sort((left, right) => (
        (left.item.purchaseDate ?? '9999-12-31').localeCompare(right.item.purchaseDate ?? '9999-12-31')
        || comparePurchaseOptionHint(left.item, right.item, outbound.item)
        || comparePurchaseChannelHint(left.item, right.item, outbound.item)
        || left.item.sourceRowNumber - right.item.sourceRowNumber
        || left.index - right.index
      ))

    for (const history of candidates) {
      if (outbound.remainingQuantity === 0) break
      const consumed = Math.min(history.remainingQuantity, outbound.remainingQuantity)
      history.remainingQuantity -= consumed
      outbound.remainingQuantity -= consumed
    }
  }

  return remainingHistoryItems.flatMap(({ item, remainingQuantity }) => (
    remainingQuantity > 0 ? [{ ...item, quantity: remainingQuantity }] : []
  ))
}

function purchaseHistoryCanUseStrongOutboundMatch(
  purchase: EcountPurchaseCompletedItem,
  outbound: EcountOutboundPendingItem,
) {
  // Even an exact workflow/order identifier cannot describe a shipment that
  // predates the purchase-history arrival. Keep undated legacy rows eligible,
  // but never use a known future arrival to complete an older outbound.
  return !purchase.purchaseDate || purchase.purchaseDate <= outbound.effectiveDate
}

function purchaseHistoryCanUseOutboundFifo(
  purchase: EcountPurchaseCompletedItem,
  outbound: EcountOutboundPendingItem,
) {
  if (purchase.sku !== outbound.sku) return false
  // Unknown/future arrival dates cannot safely be consumed by a dated shipment.
  return Boolean(purchase.purchaseDate && purchase.purchaseDate <= outbound.effectiveDate)
}

function comparePurchaseOptionHint(
  left: EcountPurchaseCompletedItem,
  right: EcountPurchaseCompletedItem,
  outbound: EcountOutboundPendingItem,
) {
  const outboundOption = normalizePurchaseOption(outbound.optionName)
  if (!outboundOption) return 0
  const leftMatches = normalizePurchaseOption(left.optionName) === outboundOption
  const rightMatches = normalizePurchaseOption(right.optionName) === outboundOption
  return Number(rightMatches) - Number(leftMatches)
}

function comparePurchaseChannelHint(
  left: EcountPurchaseCompletedItem,
  right: EcountPurchaseCompletedItem,
  outbound: EcountOutboundPendingItem,
) {
  const outboundHint = purchaseChannelHint(outbound.supplierOrderNumber)
  if (!outboundHint) return 0
  const leftMatches = purchaseChannelHint(left.supplierOrderNumber) === outboundHint
  const rightMatches = purchaseChannelHint(right.supplierOrderNumber) === outboundHint
  return Number(rightMatches) - Number(leftMatches)
}

function purchaseChannelHint(value: string | null) {
  const normalized = value?.normalize('NFKC').trim().toLocaleLowerCase() ?? ''
  if (!normalized || isUniqueSupplierOrderIdentifier(normalized)) return null
  if (/(?:웨이신|위챗|wechat|weixin)/i.test(normalized)) return 'wechat'
  if (/(?:알리페이|alipay)/i.test(normalized)) return 'alipay'
  if (/(?:ssj|신성진)/i.test(normalized)) return 'ssj'
  if (/(?:핀둬둬|pinduoduo)/i.test(normalized)) return 'pinduoduo'
  return normalized
}

function reconcilePurchaseHistoryWithChinaInventory(
  historyItems: EcountPurchaseCompletedItem[],
  inventoryItems: EcountChinaInventoryItem[],
  inventorySnapshotDate: string | null,
  domesticInventoryReflectedThrough: string,
) {
  // A dated but empty workbook can be an incomplete/incorrect export. Never
  // infer that every China arrival shipped from an empty snapshot. Likewise,
  // if domestic inventory has not caught up to this China snapshot, an absent
  // item may still be in transit and must remain in the recommendation bridge.
  if (!inventorySnapshotDate || inventoryItems.length === 0) {
    return {
      items: historyItems,
      pendingQuantityByHistoryKey: new Map<string, number>(),
    }
  }
  const canCompleteDomesticArrival = domesticInventoryReflectedThrough >= inventorySnapshotDate

  const inventoryBySku = new Map<string, number>()
  for (const item of inventoryItems) {
    const key = purchaseSkuKey(item.sku)
    inventoryBySku.set(key, (inventoryBySku.get(key) ?? 0) + item.quantity)
  }

  const retainedQuantityByIndex = new Map<number, number>()
  const inventoryBackedQuantityByIndex = new Map<number, number>()
  const eligibleBySku = new Map<string, Array<{
    item: EcountPurchaseCompletedItem
    index: number
  }>>()

  historyItems.forEach((item, index) => {
    if (!item.purchaseDate || item.purchaseDate > inventorySnapshotDate) {
      retainedQuantityByIndex.set(index, item.quantity)
      return
    }
    const key = purchaseSkuKey(item.sku)
    const matches = eligibleBySku.get(key) ?? []
    matches.push({ item, index })
    eligibleBySku.set(key, matches)
  })

  for (const [key, items] of eligibleBySku) {
    let stockRemaining = inventoryBySku.get(key) ?? 0
    const newestFirst = [...items].sort((left, right) => (
      (right.item.purchaseDate ?? '').localeCompare(left.item.purchaseDate ?? '')
      || right.item.sourceRowNumber - left.item.sourceRowNumber
      || right.index - left.index
    ))
    for (const { item, index } of newestFirst) {
      const retainedQuantity = Math.min(item.quantity, stockRemaining)
      inventoryBackedQuantityByIndex.set(index, retainedQuantity)
      if (canCompleteDomesticArrival && retainedQuantity > 0) {
        retainedQuantityByIndex.set(index, retainedQuantity)
      }
      stockRemaining -= retainedQuantity
    }
  }

  const items = historyItems.flatMap((item, index) => {
    // Same-day arrivals may have been recorded after the inventory export, so
    // keep the order-level row even when no inventory quantity covers it.
    if (item.purchaseDate === inventorySnapshotDate) return [item]
    if (!canCompleteDomesticArrival && item.purchaseDate && item.purchaseDate < inventorySnapshotDate) {
      return [item]
    }
    const retainedQuantity = retainedQuantityByIndex.get(index) ?? 0
    return retainedQuantity > 0 ? [{ ...item, quantity: retainedQuantity }] : []
  })
  const pendingQuantityByHistoryKey = new Map<string, number>()
  historyItems.forEach((item, index) => {
    if (!item.purchaseDate || item.purchaseDate > inventorySnapshotDate) return
    const inventoryBackedQuantity = inventoryBackedQuantityByIndex.get(index) ?? 0
    const pendingQuantity = item.purchaseDate === inventorySnapshotDate || !canCompleteDomesticArrival
      ? item.quantity - inventoryBackedQuantity
      : 0
    // Keep zeroes as an explicit reconciliation result. A late/backfilled
    // purchase-history upload may also carry a generic bridge key; inventory
    // allocation is more precise and must override that full-quantity fallback.
    pendingQuantityByHistoryKey.set(getPurchaseHistoryBridgeKey(item), pendingQuantity)
  })

  return { items, pendingQuantityByHistoryKey }
}

function purchaseSkuKey(sku: string) {
  return sku.trim().toLocaleLowerCase()
}

function normalizePurchaseOption(value: string | null) {
  return value?.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase() ?? ''
}

function reconcilePlanWithPurchaseHistory(
  planItems: EcountPurchaseCompletedItem[],
  historyItems: EcountPurchaseCompletedItem[],
) {
  const remainingHistoryQuantity = new Map<number, number>(
    historyItems.map((item, index) => [index, item.quantity]),
  )
  const orderedHistory = historyItems
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (
      (left.item.purchaseDate ?? '9999-12-31').localeCompare(right.item.purchaseDate ?? '9999-12-31')
      || left.item.sourceRowNumber - right.item.sourceRowNumber
      || left.index - right.index
    ))

  return planItems.flatMap((plan) => {
    // Purchase-management-code + SKU is the workflow identity. Supplier
    // order + SKU is only used where one side lacks that management key. A
    // strong match means the plan has progressed despite report quantities
    // being different.
    const strongMatch = orderedHistory.some(({ item }) => {
      return purchasingItemsMatch(plan, item)
    })
    if (strongMatch) return []

    let remaining = plan.quantity
    const candidates = orderedHistory
      .map(({ item, index }) => ({ item, index, score: pipelineMatchScore(plan, item) }))
      .filter((candidate) => candidate.score > 0 && (remainingHistoryQuantity.get(candidate.index) ?? 0) > 0)
      .sort((left, right) => (
        right.score - left.score
        || (left.item.purchaseDate ?? '9999-12-31').localeCompare(right.item.purchaseDate ?? '9999-12-31')
        || left.item.sourceRowNumber - right.item.sourceRowNumber
      ))

    for (const candidate of candidates) {
      if (remaining === 0) break
      const historyRemaining = remainingHistoryQuantity.get(candidate.index) ?? 0
      const consumed = Math.min(remaining, historyRemaining)
      if (consumed === 0) continue
      remaining -= consumed
      remainingHistoryQuantity.set(candidate.index, historyRemaining - consumed)
    }

    return remaining > 0 ? [{ ...plan, quantity: remaining }] : []
  })
}

function aggregateChinaOutboundItems(
  selectedItems: EcountOutboundPendingItem[],
  allItems: EcountOutboundPendingItem[],
  historyItems: EcountPurchaseCompletedItem[],
) {
  const purchasedQuantityByManagementCode = new Map<string, number>()
  const purchasedQuantityBySupplierOrder = new Map<string, number>()
  for (const item of historyItems) {
    const managementKey = item.purchaseManagementCode
      ? purchaseKey(item.purchaseManagementCode, item.sku)
      : null
    if (managementKey) {
      purchasedQuantityByManagementCode.set(
        managementKey,
        (purchasedQuantityByManagementCode.get(managementKey) ?? 0) + item.quantity,
      )
    }
    const supplierOrderKey = supplierKey(item.supplierOrderNumber, item.sku)
    if (supplierOrderKey) {
      purchasedQuantityBySupplierOrder.set(
        supplierOrderKey,
        (purchasedQuantityBySupplierOrder.get(supplierOrderKey) ?? 0) + item.quantity,
      )
    }
  }

  const allItemsByOrder = new Map<string, EcountOutboundPendingItem[]>()
  for (const item of allItems) {
    const key = outboundOrderKey(item)
    const rows = allItemsByOrder.get(key) ?? []
    rows.push(item)
    allItemsByOrder.set(key, rows)
  }

  const selectedGroups = new Map<string, EcountOutboundPendingItem[]>()
  for (const item of selectedItems) {
    const orderKey = outboundOrderKey(item)
    const groupKey = `${orderKey}::${item.effectiveDate}`
    const rows = selectedGroups.get(groupKey) ?? []
    rows.push(item)
    selectedGroups.set(groupKey, rows)
  }

  return [...selectedGroups.values()].map((items) => {
    const orderedItems = [...items].sort((left, right) => left.sourceRowNumber - right.sourceRowNumber)
    const latest = orderedItems[orderedItems.length - 1]
    const orderKey = outboundOrderKey(latest)
    const everyOrderItem = allItemsByOrder.get(orderKey) ?? orderedItems
    const quantity = orderedItems.reduce((sum, item) => sum + item.quantity, 0)
    const cumulativeOutboundQuantity = everyOrderItem
      .filter((item) => item.effectiveDate <= latest.effectiveDate)
      .reduce((sum, item) => sum + item.quantity, 0)
    const totalOutboundQuantity = everyOrderItem.reduce((sum, item) => sum + item.quantity, 0)
    const purchasedQuantity = latest.purchaseManagementCode
      ? purchasedQuantityByManagementCode.get(purchaseKey(latest.purchaseManagementCode, latest.sku)!) ?? null
      : latest.supplierOrderNumber
        ? purchasedQuantityBySupplierOrder.get(supplierKey(latest.supplierOrderNumber, latest.sku)!) ?? null
        : null
    const outboundComponents = orderedItems.flatMap((item) => item.outboundComponents)
    const componentMatchKeys = outboundComponents.map((component) => component.matchKey)

    return {
      ...latest,
      quantity,
      fallbackMatchKey: componentMatchKeys.length === 1
        ? componentMatchKeys[0]
        : `shipment-group:${latest.effectiveDate}:${orderKey}`,
      componentMatchKeys,
      outboundComponents,
      cumulativeOutboundQuantity,
      totalOutboundQuantity,
      purchasedQuantity,
      isFullyOutbound: purchasedQuantity !== null && cumulativeOutboundQuantity >= purchasedQuantity,
    }
  })
}

function outboundOrderKey(item: EcountOutboundPendingItem) {
  return (item.purchaseManagementCode
    ? purchaseKey(item.purchaseManagementCode, item.sku)
    : null) ?? supplierKey(item.supplierOrderNumber, item.sku) ?? item.fallbackMatchKey
}

function removeReflectedOutboundComponents(
  item: EcountOutboundPendingItem,
  reflectedMatchKeys: Set<string>,
): EcountOutboundPendingItem | null {
  const outboundComponents = item.outboundComponents.filter((component) => (
    !reflectedMatchKeys.has(component.matchKey)
    && outboundComponentLegacyMatchKeys(component).every((key) => !reflectedMatchKeys.has(key))
  ))
  if (outboundComponents.length === 0) return null

  const quantity = outboundComponents.reduce((sum, component) => sum + component.quantity, 0)
  const componentMatchKeys = outboundComponents.map((component) => component.matchKey)
  return {
    ...item,
    quantity,
    fallbackMatchKey: componentMatchKeys.length === 1
      ? componentMatchKeys[0]
      : item.fallbackMatchKey,
    componentMatchKeys,
    outboundComponents,
  }
}

function removeIgnoredOutboundComponents(
  item: EcountOutboundPendingItem,
  ignoredKeys: ReadonlySet<string>,
): EcountOutboundPendingItem | null {
  const outboundComponents = item.outboundComponents.filter((component) => (
    !ignoredKeys.has(purchasingOutboundComponentIdentity({
      source: ECOUNT_OUTBOUND_SOURCE,
      sku: item.sku,
      purchaseManagementCode: item.purchaseManagementCode,
      componentMatchKey: component.matchKey,
    }))
  ))
  if (outboundComponents.length === 0) return null
  if (outboundComponents.length === item.outboundComponents.length) return item

  const quantity = outboundComponents.reduce((sum, component) => sum + component.quantity, 0)
  const componentMatchKeys = outboundComponents.map((component) => component.matchKey)
  return {
    ...item,
    quantity,
    fallbackMatchKey: componentMatchKeys.length === 1
      ? componentMatchKeys[0]
      : item.fallbackMatchKey,
    componentMatchKeys,
    outboundComponents,
  }
}

function outboundComponentLegacyMatchKeys(component: EcountOutboundPendingItem['outboundComponents'][number] | undefined) {
  if (!component) return []
  return [...new Set([
    component.legacyMatchKey,
    ...(Array.isArray(component.legacyMatchKeys) ? component.legacyMatchKeys : []),
  ].filter((key): key is string => typeof key === 'string' && key.length > 0))]
}

function pipelineMatchScore(
  left: EcountPurchaseCompletedItem,
  right: EcountPurchaseCompletedItem,
) {
  if (left.sku !== right.sku) return 0
  const managementMatches = Boolean(
    left.purchaseManagementCode
    && right.purchaseManagementCode
    && left.purchaseManagementCode === right.purchaseManagementCode,
  )
  const leftSupplierOrderKey = supplierKey(left.supplierOrderNumber, left.sku)
  const rightSupplierOrderKey = supplierKey(right.supplierOrderNumber, right.sku)
  const orderMatches = Boolean(
    leftSupplierOrderKey
    && rightSupplierOrderKey
    && leftSupplierOrderKey === rightSupplierOrderKey,
  )
  const managementConflicts = Boolean(
    left.purchaseManagementCode
    && right.purchaseManagementCode
    && left.purchaseManagementCode !== right.purchaseManagementCode,
  )
  const orderConflicts = Boolean(
    leftSupplierOrderKey
    && rightSupplierOrderKey
    && leftSupplierOrderKey !== rightSupplierOrderKey,
  )
  const managementKeyAvailableOnBothSides = Boolean(
    left.purchaseManagementCode && right.purchaseManagementCode,
  )
  const supplierOrderAvailableOnBothSides = Boolean(leftSupplierOrderKey && rightSupplierOrderKey)
  // Management code is authoritative whenever both reports carry it. Supplier
  // order only breaks ties when the management key is unavailable on a side.
  if (managementKeyAvailableOnBothSides && managementConflicts) return 0
  if (!managementKeyAvailableOnBothSides && supplierOrderAvailableOnBothSides && orderConflicts) return 0

  const leftOption = left.optionName?.trim() ?? ''
  const rightOption = right.optionName?.trim() ?? ''
  // Unidentified legacy rows retain the prior SKU/option fallback. Option
  // labels often change between Ecount reports, so an identifier match is
  // still allowed to override a differing option label.
  if (!orderMatches && !managementMatches && leftOption && rightOption && leftOption !== rightOption) return 0

  let score = 10
  if (leftOption && rightOption && leftOption === rightOption) score += 10
  if (managementMatches) score += 100
  else if (orderMatches) score += 80
  return score
}

export function summarizeEcountPurchasingSnapshot(snapshot: EcountPurchasingSnapshot) {
  return {
    asOfDate: snapshot.asOfDate,
    domesticInventoryReflectedThrough: snapshot.domesticInventoryReflectedThrough,
    purchasePlanConfirmedSince: snapshot.purchasePlanConfirmedSince,
    files: snapshot.files,
    activeRequests: {
      rows: snapshot.activeRequests.length,
      quantity: sumQuantities(snapshot.activeRequests),
      samples: snapshot.activeRequests.slice(0, 5).map((item) => ({
        sku: item.sku,
        productName: item.productName,
        quantity: item.requestedQuantity,
      })),
    },
    purchaseCompleted: {
      rows: snapshot.purchaseCompleted.length,
      quantity: sumQuantities(snapshot.purchaseCompleted),
      confirmedPlanRows: snapshot.purchaseCompleted.filter(
        (item) => item.source === ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE,
      ).length,
      samples: snapshot.purchaseCompleted.slice(0, 5).map((item) => ({
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        chinaArrivalRequestDate: item.chinaArrivalRequestDate,
      })),
    },
    chinaArrived: {
      rows: snapshot.chinaArrived.length,
      quantity: sumQuantities(snapshot.chinaArrived),
      pendingChinaInventoryQuantity: snapshot.chinaArrived.reduce(
        (sum, item) => sum + item.pendingChinaInventoryQuantity,
        0,
      ),
      samples: snapshot.chinaArrived.slice(0, 5).map((item) => ({
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        supplierOrderNumber: item.supplierOrderNumber,
      })),
    },
    chinaInventory: {
      rows: snapshot.chinaInventory.length,
      quantity: sumQuantities(snapshot.chinaInventory),
      samples: snapshot.chinaInventory.slice(0, 5).map((item) => ({
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
      })),
    },
    outboundCompleted: {
      rows: snapshot.outboundCompleted.length,
      quantity: sumQuantities(snapshot.outboundCompleted),
      samples: snapshot.outboundCompleted.slice(0, 5).map((item) => ({
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        effectiveDate: item.effectiveDate,
      })),
    },
    outboundPending: {
      rows: snapshot.outboundPending.length,
      quantity: sumQuantities(snapshot.outboundPending),
      samples: snapshot.outboundPending.slice(0, 5).map((item) => ({
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        effectiveDate: item.effectiveDate,
      })),
    },
    validation: snapshot.validation,
    warnings: snapshot.warnings,
  }
}

export async function getEcountPurchasingSyncState(userId: string) {
  const [[{ purchaseRows } = { purchaseRows: 0 }], [{ chinaRows, chinaQuantity } = {
    chinaRows: 0,
    chinaQuantity: 0,
  }]] = await Promise.all([
    db.select({
      purchaseRows: sql<number>`COUNT(*)::int`,
    }).from(purchaseRequestItems).where(and(
      eq(purchaseRequestItems.userId, userId),
      isReplaceableEcountSource(),
    )),
    db.select({
      chinaRows: sql<number>`COUNT(*)::int`,
      chinaQuantity: sql<number>`COALESCE(SUM(${chinaWarehouseInventory.availableQuantity}), 0)::int`,
    }).from(chinaWarehouseInventory).where(and(
      eq(chinaWarehouseInventory.userId, userId),
      sql`${chinaWarehouseInventory.availableQuantity} > 0`,
    )),
  ])

  return { purchaseRows, chinaRows, chinaQuantity }
}

/** Fallback only when the inventory workbook has no printed snapshot date. */
export async function getLatestChinaInventorySnapshotAsOfDate(userId: string) {
  const [[arrivalRow], [inventoryRow]] = await Promise.all([
    db
      .select({
        snapshotAsOfDate: sql<string | null>`MAX(${purchaseRequestItems.rawData}->>'snapshotAsOfDate')`,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, userId),
        sql`${purchaseRequestItems.rawData}->>'source' = ${ECOUNT_CHINA_ARRIVED_SOURCE}`,
      )),
    // China inventory no longer creates purchase-request rows. Its latest
    // write time is a safe fallback baseline when the workbook itself has no
    // printed snapshot date.
    db
      .select({
        snapshotAsOfDate: sql<string | null>`MAX((timezone('Asia/Seoul', ${chinaWarehouseInventory.updatedAt}))::date)::text`,
      })
      .from(chinaWarehouseInventory)
      .where(eq(chinaWarehouseInventory.userId, userId)),
  ])
  return resolveChinaInventorySnapshotAsOfDate(
    arrivalRow?.snapshotAsOfDate ?? null,
    inventoryRow?.snapshotAsOfDate ?? null,
  )
}

/**
 * A printed workbook snapshot date is the authoritative inventory baseline.
 * `updatedAt` only says when we uploaded that workbook, so it is a fallback
 * for legacy rows that lack the printed date.
 */
export function resolveChinaInventorySnapshotAsOfDate(
  arrivalSnapshotAsOfDate: string | null,
  inventoryUpdatedAtDate: string | null,
) {
  const arrivalSnapshotDate = arrivalSnapshotAsOfDate
    ? normalizeDateOnly(arrivalSnapshotAsOfDate)
    : null
  if (arrivalSnapshotDate) return arrivalSnapshotDate
  return inventoryUpdatedAtDate ? normalizeDateOnly(inventoryUpdatedAtDate) : null
}

/**
 * Purchase-history rows newer than the China-inventory snapshot are kept as
 * China-arrival rows with a small pipeline marker. Persist their keys so a
 * later partial upload does not lose that temporary protection.
 */
export async function getPersistedPurchaseHistoryBridgeKeys(userId: string) {
  const rows = await db
    .select({
      bridgeKey: sql<string | null>`${purchaseRequestItems.rawData}->>'purchaseHistoryBridgeKey'`,
    })
    .from(purchaseRequestItems)
    .where(and(
      eq(purchaseRequestItems.userId, userId),
      sql`COALESCE(${purchaseRequestItems.rawData}->>'purchaseHistoryBridgeKey', '') <> ''`,
      or(
        and(
          eq(purchaseRequestItems.status, 'china_arrived'),
          sql`${purchaseRequestItems.rawData}->>'source' = ${ECOUNT_CHINA_ARRIVED_SOURCE}`,
          sql`${purchaseRequestItems.rawData}->>'pendingChinaInventorySnapshot' = 'true'`,
        ),
        // Kept only for a safe transition from the prior implementation,
        // which stored this marker as a duplicate purchase_completed row.
        and(
          eq(purchaseRequestItems.status, 'purchase_completed'),
          sql`${purchaseRequestItems.rawData}->>'source' = ${ECOUNT_PURCHASE_COMPLETED_SOURCE}`,
        ),
      )!,
    ))

  return rows
    .map((row) => row.bridgeKey?.trim() ?? '')
    .filter((key): key is string => key.length > 0)
}

export async function syncEcountPurchasingSnapshot(input: {
  userId: string
  requestedByUserId: string
  snapshot: EcountPurchasingSnapshot
  reportKinds?: EcountReportKind[]
}) {
  const [
    reflectedOutboundMatchKeys,
    exchangeRateReference,
  ] = await Promise.all([
    getReflectedOutboundMatchKeys(input.userId),
    getLatestCnyKrwReferenceRate(),
    ensureIgnoredPurchasingItemsTable(),
    ensurePurchasePaymentTrackingSchema(),
    ensurePurchaseRequestManagementCodeSkuLookupIndex(),
    ensurePurchaseFundLedgerSchema(),
  ])
  const refreshScope = getEcountPurchasingRefreshScope(input.reportKinds)
  const refreshOutbound = refreshScope.refreshOutbound
  // A purchase-history-only upload replaces the old China-arrival rows. Keep
  // the latest inventory snapshot date on those rows so the temporary
  // recommendation bridge remains safe even after the old inventory-derived
  // rows have been removed.
  const latestChinaInventorySnapshotAsOfDate = (
    refreshScope.reportKinds.has('purchaseHistory')
    || refreshScope.reportKinds.has('chinaInventory')
    || refreshScope.refreshOutbound
  )
    ? await getLatestChinaInventorySnapshotAsOfDate(input.userId)
    : null
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)
    const ignoredPurchasingItemKeys = await getIgnoredPurchasingItemKeysInTransaction(tx, input.userId)

    const {
      reportKinds,
      refreshPurchasePipeline,
      refreshOutbound,
      sourcesToReplace,
    } = getEcountPurchasingRefreshScope(input.reportKinds)
    const refreshPurchaseHistoryBridge = refreshOutbound || reportKinds.has('chinaInventory')
    const refreshChinaArrivals = reportKinds.has('purchaseHistory')
      || reportKinds.has('chinaInventory')
      || refreshOutbound
    const selectedActiveRequests = (refreshPurchasePipeline ? input.snapshot.activeRequests : [])
      .filter((item) => !isPurchasingItemIgnored(ignoredPurchasingItemKeys, {
        source: ECOUNT_PENDING_REQUEST_SOURCE,
        sku: item.sku,
        purchaseManagementCode: item.purchaseManagementCode,
        supplierOrderNumber: null,
        fallbackDiscriminator: `${item.sourceDateNo}|${item.sourceRowNumber}`,
      }))
    const selectedPurchaseCompleted = (
      refreshPurchasePipeline
        ? input.snapshot.purchaseCompleted
        : refreshPurchaseHistoryBridge
          ? input.snapshot.purchaseCompleted.filter(
            (item) => item.source === ECOUNT_PURCHASE_COMPLETED_SOURCE,
          )
          : []
    )
      .filter((item) => !isPurchasingItemIgnored(ignoredPurchasingItemKeys, {
        source: item.source,
        sku: item.sku,
        purchaseManagementCode: item.purchaseManagementCode,
        supplierOrderNumber: item.supplierOrderNumber,
        // Purchase-history rows persist the durable bridge key in rawData.
        // Request/plan rows do not, so their stored tombstone uses the same
        // source row fallback written to rawData below.
        fallbackDiscriminator: item.source === ECOUNT_PURCHASE_COMPLETED_SOURCE
          ? getPurchaseHistoryBridgeKey(item)
          : `${item.sourceDateNo}|${item.sourceRowNumber}`,
      }))
    const selectedChinaArrived = (refreshChinaArrivals ? input.snapshot.chinaArrived : [])
      .filter((item) => !isPurchasingItemIgnored(ignoredPurchasingItemKeys, {
        source: ECOUNT_CHINA_ARRIVED_SOURCE,
        sku: item.sku,
        purchaseManagementCode: item.purchaseManagementCode,
        supplierOrderNumber: item.supplierOrderNumber,
        fallbackDiscriminator: getPurchaseHistoryBridgeKey(item),
      }))
    const selectedOutboundPending = (refreshOutbound ? input.snapshot.outboundPending : [])
      .map((item) => removeIgnoredOutboundComponents(item, ignoredPurchasingItemKeys))
      .filter((item): item is EcountOutboundPendingItem => item !== null)
      .filter((item) => !isPurchasingItemIgnored(ignoredPurchasingItemKeys, {
        source: ECOUNT_OUTBOUND_SOURCE,
        sku: item.sku,
        purchaseManagementCode: item.purchaseManagementCode,
        supplierOrderNumber: item.supplierOrderNumber,
        // Management/order keyed rows are aggregated per outbound date. The
        // component fallback can change when another split-shipment row is
        // added to that same date, while effectiveDate remains stable.
        fallbackDiscriminator: item.purchaseManagementCode
          || reliableSupplierOrderNumber(item.supplierOrderNumber ?? '')
          ? item.effectiveDate
          : item.fallbackMatchKey,
        includeFallbackDiscriminator: true,
      }))
    const selectedOutboundCompleted = (refreshOutbound ? input.snapshot.outboundCompleted : [])
      .map((item) => removeReflectedOutboundComponents(item, reflectedOutboundMatchKeys))
      .filter((item): item is EcountOutboundPendingItem => item !== null)
      .map((item) => removeIgnoredOutboundComponents(item, ignoredPurchasingItemKeys))
      .filter((item): item is EcountOutboundPendingItem => item !== null)
      .filter((item) => !isPurchasingItemIgnored(ignoredPurchasingItemKeys, {
        // A manually completed/deleted pending shipment must also suppress
        // the same row after its raw-data date advances it to completed.
        source: ECOUNT_OUTBOUND_SOURCE,
        sku: item.sku,
        purchaseManagementCode: item.purchaseManagementCode,
        supplierOrderNumber: item.supplierOrderNumber,
        fallbackDiscriminator: item.purchaseManagementCode
          || reliableSupplierOrderNumber(item.supplierOrderNumber ?? '')
          ? item.effectiveDate
          : item.fallbackMatchKey,
        includeFallbackDiscriminator: true,
      }))

    // A row explicitly moved into the SaaS China-inventory workflow remains
    // user-managed after the raw Ecount snapshot refresh. Keep it in place
    // and suppress only the same management-code + SKU snapshot row; using a
    // weaker key here could hide a different purchase accidentally.
    const saasChinaProtectedRows = await tx
      .select({
        sku: purchaseRequestItems.sku,
        purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
        rawData: purchaseRequestItems.rawData,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        sql`${purchaseRequestItems.rawData}->'saasChinaMode' = 'true'::jsonb`,
      ))
    const saasChinaProtectedPurchaseKeys = getSaasChinaProtectedPurchaseKeys(
      saasChinaProtectedRows,
    )
    const snapshotManagedItems = [
      ...selectedActiveRequests,
      ...selectedPurchaseCompleted,
      ...selectedChinaArrived,
    ]
    const activeCodes = [...new Set(snapshotManagedItems
      .map((item) => item.purchaseManagementCode)
      .filter((code): code is string => Boolean(code)))]
    if (activeCodes.length > 0) {
      const existingRows = await tx
        .select({
          sku: purchaseRequestItems.sku,
          purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
          rawData: purchaseRequestItems.rawData,
        })
        .from(purchaseRequestItems)
        .where(and(
          eq(purchaseRequestItems.userId, input.userId),
          inArray(purchaseRequestItems.purchaseManagementCode, activeCodes),
        ))
      const conflicts = existingRows.filter((row) => {
        const source = readRawDataSource(row.rawData)
        const isMatchingProtectedSaasChinaRow = isSaasChinaMode(row.rawData)
          && snapshotManagedItems.some((item) => saasChinaPurchaseKeysMatch(row, item))
        if (isMatchingProtectedSaasChinaRow) return false
        return !REPLACEABLE_ECOUNT_SOURCES.includes(source as (typeof REPLACEABLE_ECOUNT_SOURCES)[number])
          && snapshotManagedItems.some((item) => (
            item.purchaseManagementCode === row.purchaseManagementCode && item.sku === row.sku
          ))
      })
      if (conflicts.length > 0) {
        throw new Error(`다른 발주 데이터와 겹치는 구입관리코드+품목이 ${conflicts.length.toLocaleString('ko-KR')}건 있습니다. 기존 행을 확인한 뒤 다시 동기화해주세요.`)
      }
    }

    const insertableActiveRequests = excludeSaasChinaProtectedSnapshotItems(
      selectedActiveRequests,
      saasChinaProtectedPurchaseKeys,
    )
    const insertablePurchaseCompleted = excludeSaasChinaProtectedSnapshotItems(
      selectedPurchaseCompleted,
      saasChinaProtectedPurchaseKeys,
    )
    const insertableChinaArrived = excludeSaasChinaProtectedSnapshotItems(
      selectedChinaArrived,
      saasChinaProtectedPurchaseKeys,
    )
    const insertableOutboundPending = excludeSaasChinaProtectedSnapshotItems(
      selectedOutboundPending,
      saasChinaProtectedPurchaseKeys,
    )
    const insertableOutboundCompleted = excludeSaasChinaProtectedSnapshotItems(
      selectedOutboundCompleted,
      saasChinaProtectedPurchaseKeys,
    )

    const replaceableRows = await tx
      .select({
        id: purchaseRequestItems.id,
        sku: purchaseRequestItems.sku,
        purchaseManagementCode: purchaseRequestItems.purchaseManagementCode,
        supplierOrderNumber: purchaseRequestItems.supplierOrderNumber,
        bulkPaymentPending: purchaseRequestItems.bulkPaymentPending,
        bulkPaymentDueDate: purchaseRequestItems.bulkPaymentDueDate,
        bulkPaymentDepositCny: purchaseRequestItems.bulkPaymentDepositCny,
        bulkPaymentDepositKrw: purchaseRequestItems.bulkPaymentDepositKrw,
        bulkPaymentDepositPaidAt: purchaseRequestItems.bulkPaymentDepositPaidAt,
        bulkPaymentDepositMemo: purchaseRequestItems.bulkPaymentDepositMemo,
        rawData: purchaseRequestItems.rawData,
        updatedAt: purchaseRequestItems.updatedAt,
      })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        isReplaceableEcountSource(sourcesToReplace),
      ))
      .orderBy(desc(purchaseRequestItems.updatedAt))
    const replaceableRowsToDelete = replaceableRows.filter((row) => !isSaasChinaMode(row.rawData))
    const bulkPaymentOverrides = collectBulkPaymentOverrides(replaceableRowsToDelete)
    if (replaceableRowsToDelete.length > 0) {
      await tx.delete(purchaseRequestItems).where(inArray(
        purchaseRequestItems.id,
        replaceableRowsToDelete.map((row) => row.id),
      ))
    }

    const [{ maxRowNumber }] = await tx
      .select({ maxRowNumber: sql<number>`COALESCE(MAX(${purchaseRequestItems.rowNumber}), 0)::int` })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.userId, input.userId))
    let nextRowNumber = maxRowNumber
    const now = new Date()
    const snapshotDate = new Date(`${input.snapshot.asOfDate}T00:00:00.000Z`)

    const requestRows = insertableActiveRequests.map((item) => ({
      userId: input.userId,
      rowNumber: ++nextRowNumber,
      status: 'purchased' as const,
      requestDate: item.requestDate,
      sku: item.sku,
      productName: item.productName,
      optionName: item.optionName,
      requestedQuantity: item.requestedQuantity,
      actualPurchaseQuantity: item.requestedQuantity,
      chinaArrivalRequestDate: item.chinaArrivalRequestDate,
      purchaseManagementCode: item.purchaseManagementCode,
      buyerName: item.buyerName,
      rawData: {
        source: ECOUNT_PENDING_REQUEST_SOURCE,
        sourceFileName: item.sourceFileName,
        sourceRowNumber: item.sourceRowNumber,
        sourceDateNo: item.sourceDateNo,
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
    }))
    const purchaseCompletedRows = insertablePurchaseCompleted.map((item) => ({
      userId: input.userId,
      rowNumber: ++nextRowNumber,
      status: 'purchase_completed' as const,
      requestDate: item.purchaseDate,
      outboundExpectedDate: item.purchaseDate,
      sku: item.sku,
      productName: item.productName,
      optionName: item.optionName,
      requestedQuantity: item.quantity,
      actualPurchaseQuantity: item.quantity,
      chinaArrivalRequestDate: item.chinaArrivalRequestDate,
      expectedArrivalDate: item.chinaArrivalRequestDate,
      purchaseManagementCode: item.purchaseManagementCode,
      supplierOrderNumber: item.supplierOrderNumber,
      purchaseMethod: item.purchaseMethod,
      purchaseConfirmed: true,
      unitPriceCny: item.unitPriceCny === null ? null : String(item.unitPriceCny),
      shippingFeeCny: item.shippingFeeCny === null ? null : String(item.shippingFeeCny),
      rawData: {
        source: item.source,
        sourceFileName: item.sourceFileName,
        sourceRowNumber: item.sourceRowNumber,
        sourceDateNo: item.sourceDateNo,
        sourceRequestFileName: item.sourceRequestFileName,
        sourceRequestRowNumber: item.sourceRequestRowNumber,
        purchasePlanConfirmedSince: item.source === ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE
          ? input.snapshot.purchasePlanConfirmedSince
          : null,
        purchaseOrderNumber: item.purchaseOrderNumber,
        purchaseHistoryBridgeKey: item.source === ECOUNT_PURCHASE_COMPLETED_SOURCE
          ? getPurchaseHistoryBridgeKey(item)
          : null,
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
    }))
    const chinaArrivedRows = insertableChinaArrived.map((item) => ({
      userId: input.userId,
      rowNumber: ++nextRowNumber,
      status: 'china_arrived' as const,
      requestDate: item.purchaseDate,
      sku: item.sku,
      productName: item.productName,
      optionName: item.optionName,
      requestedQuantity: item.quantity,
      actualPurchaseQuantity: item.quantity,
      chinaReceivedQuantity: item.quantity,
      chinaReceivedAt: item.purchaseDate
        ? new Date(`${item.purchaseDate}T00:00:00.000Z`)
        : snapshotDate,
      chinaArrivalRequestDate: item.chinaArrivalRequestDate,
      expectedArrivalDate: item.chinaArrivalRequestDate,
      purchaseManagementCode: item.purchaseManagementCode,
      supplierOrderNumber: item.supplierOrderNumber,
      purchaseMethod: item.purchaseMethod,
      purchaseConfirmed: true,
      sourceCurrentState: 'Ecount purchase history',
      rawData: {
        source: ECOUNT_CHINA_ARRIVED_SOURCE,
        sourceFileName: item.sourceFileName,
        sourceRowNumber: item.sourceRowNumber,
        sourceDateNo: item.sourceDateNo,
        sourceRequestFileName: item.sourceRequestFileName,
        sourceRequestRowNumber: item.sourceRequestRowNumber,
        purchaseOrderNumber: item.purchaseOrderNumber,
        purchaseHistoryBridgeKey: getPurchaseHistoryBridgeKey(item),
        pendingChinaInventorySnapshot: item.pendingChinaInventoryQuantity > 0,
        pendingChinaInventoryQuantity: item.pendingChinaInventoryQuantity,
        // Use the workbook's printed inventory date where it exists. The form
        // as-of date may be later than that snapshot. On a purchase-history-
        // only refresh retain the prior inventory baseline instead.
        snapshotAsOfDate: reportKinds.has('chinaInventory')
          ? input.snapshot.chinaInventorySnapshotAsOfDate ?? input.snapshot.asOfDate
          : latestChinaInventorySnapshotAsOfDate,
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
    }))
    const outboundRows = insertableOutboundPending.map((item) => ({
      userId: input.userId,
      rowNumber: ++nextRowNumber,
      status: 'outbound_requested' as const,
      requestDate: parseDate(item.sourceDateNo),
      sku: item.sku,
      productName: item.productName,
      optionName: item.optionName,
      requestedQuantity: item.quantity,
      actualPurchaseQuantity: item.quantity,
      chinaReceivedQuantity: item.quantity,
      purchaseManagementCode: item.purchaseManagementCode,
      supplierOrderNumber: item.supplierOrderNumber,
      outboundExpectedDate: item.effectiveDate,
      rawData: {
        source: ECOUNT_OUTBOUND_SOURCE,
        sourceFileName: item.sourceFileName,
        sourceRowNumber: item.sourceRowNumber,
        sourceDateNo: item.sourceDateNo,
        effectiveDate: item.effectiveDate,
        purchaseManagementCode: item.purchaseManagementCode,
        outboundManagementCode: item.outboundManagementCode,
        fallbackMatchKey: item.fallbackMatchKey,
        componentMatchKeys: item.componentMatchKeys,
        outboundComponents: item.outboundComponents,
        cumulativeOutboundQuantity: item.cumulativeOutboundQuantity,
        totalOutboundQuantity: item.totalOutboundQuantity,
        purchasedQuantity: item.purchasedQuantity,
        isFullyOutbound: item.isFullyOutbound,
        outboundRequestedQuantity: item.quantity,
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
    }))
    const outboundCompletedRows = insertableOutboundCompleted.map((item) => ({
      userId: input.userId,
      rowNumber: ++nextRowNumber,
      status: 'completed' as const,
      requestDate: parseDate(item.sourceDateNo),
      sku: item.sku,
      productName: item.productName,
      optionName: item.optionName,
      requestedQuantity: item.quantity,
      actualPurchaseQuantity: item.quantity,
      chinaReceivedQuantity: item.quantity,
      purchaseManagementCode: item.purchaseManagementCode,
      supplierOrderNumber: item.supplierOrderNumber,
      outboundExpectedDate: item.effectiveDate,
      purchaseConfirmed: true,
      rawData: {
        source: ECOUNT_OUTBOUND_COMPLETED_SOURCE,
        sourceFileName: item.sourceFileName,
        sourceRowNumber: item.sourceRowNumber,
        sourceDateNo: item.sourceDateNo,
        effectiveDate: item.effectiveDate,
        purchaseManagementCode: item.purchaseManagementCode,
        outboundManagementCode: item.outboundManagementCode,
        fallbackMatchKey: item.fallbackMatchKey,
        componentMatchKeys: item.componentMatchKeys,
        outboundComponents: item.outboundComponents,
        cumulativeOutboundQuantity: item.cumulativeOutboundQuantity,
        totalOutboundQuantity: item.totalOutboundQuantity,
        purchasedQuantity: item.purchasedQuantity,
        isFullyOutbound: item.isFullyOutbound,
        outboundCompletedQuantity: item.quantity,
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
      }))
    const rowsToInsert: PurchaseRequestItemInsert[] = [
      ...requestRows,
      ...purchaseCompletedRows,
      ...chinaArrivedRows,
      ...outboundRows,
      ...outboundCompletedRows,
    ].map((row) => applyBulkPaymentOverride(row, bulkPaymentOverrides))
    for (const rows of chunks(rowsToInsert, 500)) {
      await tx.insert(purchaseRequestItems).values(rows)
    }

    if (reportKinds.has('chinaInventory')) {
      await tx.delete(chinaWarehouseInventory).where(
        eq(chinaWarehouseInventory.userId, input.userId),
      )

      for (const rows of chunks(input.snapshot.chinaInventory, 500)) {
        await tx
          .insert(chinaWarehouseInventory)
          .values(rows.map((item) => ({
            userId: input.userId,
            sku: item.sku,
            productName: item.productName,
            optionKey: item.optionKey,
            optionName: item.optionName,
            warehouseQuantities: item.warehouseQuantities,
            totalQuantity: item.quantity,
            availableQuantity: item.quantity,
            updatedAt: now,
          })))
      }
    }

    // Raw-data refreshes replace lifecycle copies and can legitimately remove
    // rows that have already reached Korea. Insert newly discovered orders,
    // but never recalculate an existing historical debit from that reduced
    // logistics snapshot. A deliberately invoked ledger reconciliation can
    // still recalculate entries when a separate adjustment workflow needs it.
    await reconcilePurchaseFundDebitsInTransaction(tx, {
      userId: input.userId,
      fallbackExchangeRateKrw: exchangeRateReference.rate,
      existingEntryMode: 'preserve',
    })

    // Keep replacement and retention atomic so stale order rows never become
    // visible again between a raw-data refresh and its cleanup.
    await cleanupExpiredEcountPurchaseOrderRowsInTransaction(tx, {
      userId: input.userId,
      now,
    })

    return {
      replacedPurchaseRows: replaceableRows.length,
      createdPendingRequestRows: requestRows.length,
      createdPurchaseCompletedRows: purchaseCompletedRows.length,
      createdChinaArrivedRows: chinaArrivedRows.length,
      createdOutboundRows: outboundRows.length,
      createdOutboundCompletedRows: outboundCompletedRows.length,
      syncedChinaInventoryRows: reportKinds.has('chinaInventory') ? input.snapshot.chinaInventory.length : 0,
      chinaInventoryQuantity: reportKinds.has('chinaInventory') ? sumQuantities(input.snapshot.chinaInventory) : 0,
    }
  })

  if (refreshOutbound) {
    await cleanupExpiredCompletedOutboundItems({
      userId: input.userId,
      reflectedByUserId: input.requestedByUserId,
      fallbackExchangeRateKrw: exchangeRateReference.rate,
    })
  }

  return result
}

export function getEcountPurchasingRefreshScope(reportKindsInput?: EcountReportKind[]) {
  const reportKinds = new Set(reportKindsInput ?? REPORT_KINDS)
  const refreshPurchasePipeline = reportKinds.has('purchaseRequest')
    || reportKinds.has('purchasePlan')
    || reportKinds.has('purchaseHistory')
  const refreshOutbound = reportKinds.has('chinaOutbound') || reportKinds.has('purchaseHistory')
  const sourcesToReplace: Array<(typeof REPLACEABLE_ECOUNT_SOURCES)[number]> = []
  if (refreshPurchasePipeline) {
    sourcesToReplace.push(
      ECOUNT_PENDING_REQUEST_SOURCE,
      ECOUNT_REQUEST_COMPLETED_SOURCE,
      ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE,
      ECOUNT_PURCHASE_COMPLETED_SOURCE,
    )
  }
  // 중국창고도착 is always rebuilt from order-level 구매현황, never from the
  // SKU-level China-inventory rows. An inventory-only refresh reuses the
  // already-stored purchase-history state only to recalculate its pending
  // inventory marker; it does not map inventory rows into arrival rows.
  if (reportKinds.has('purchaseHistory') || reportKinds.has('chinaInventory') || refreshOutbound) {
    sourcesToReplace.push(ECOUNT_CHINA_ARRIVED_SOURCE)
  }
  if (reportKinds.has('chinaInventory') && !refreshPurchasePipeline) {
    sourcesToReplace.push(ECOUNT_PURCHASE_COMPLETED_SOURCE)
  }
  if (refreshOutbound && !refreshPurchasePipeline) {
    sourcesToReplace.push(ECOUNT_PURCHASE_COMPLETED_SOURCE)
  }
  if (refreshOutbound) sourcesToReplace.push(ECOUNT_OUTBOUND_SOURCE, ECOUNT_OUTBOUND_COMPLETED_SOURCE)

  return { reportKinds, refreshPurchasePipeline, refreshOutbound, sourcesToReplace }
}

async function loadEcountReport(input: EcountPurchasingUpload): Promise<ParsedReport> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(input.fileBuffer) as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error(`${input.fileName}: 시트를 찾을 수 없습니다.`)

  const header = findReportHeader(sheet)
  if (!header) {
    throw new Error(`${input.fileName}: 지원하는 Ecount 발주 원본 양식을 찾지 못했습니다. ${describeHeaderProblem(sheet)}`)
  }

  return {
    kind: header.kind,
    fileName: input.fileName,
    sheet,
    headerRowNumber: header.rowNumber,
    columns: header.columns,
  }
}

function findReportHeader(sheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const columns = new Map<string, number>()
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell, column) => {
      const header = normalizeHeader(cellText(cell.value))
      if (header && !columns.has(header)) columns.set(header, column)
    })
    const definition = REPORT_DEFINITIONS.find((candidate) => (
      reportHeaderSignatures(candidate).some((requiredHeaders) => (
        requiredHeaders.every((header) => columns.has(header))
      ))
    ))
    if (definition) return { kind: definition.kind, rowNumber, columns }
  }
  return null
}

function readRows(report: ParsedReport) {
  const rows: Array<{ number: number; row: ExcelJS.Row }> = []
  for (let rowNumber = report.headerRowNumber + 1; rowNumber <= report.sheet.rowCount; rowNumber += 1) {
    const row = report.sheet.getRow(rowNumber)
    let hasValue = false
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cellText(cell.value) !== '') hasValue = true
    })
    if (!hasValue) continue
    rows.push({ number: rowNumber, row })
  }
  return rows
}

function valueAt(
  source: { row: ExcelJS.Row },
  report: ParsedReport,
  header: string,
) {
  const aliases = REPORT_HEADER_ALIASES[report.kind]?.[header] ?? []
  for (const candidate of [header, ...aliases]) {
    const column = report.columns.get(candidate)
    if (!column) continue
    const value = cellText(source.row.getCell(column).value)
    if (value !== '') return value
  }
  return ''
}

function normalizeHeader(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return ''
  if (value instanceof Date) return formatDate(value)
  if (typeof value === 'object') {
    if ('result' in value && value.result != null) return cellText(value.result as ExcelJS.CellValue)
    if ('text' in value && typeof value.text === 'string') return value.text.trim()
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('').trim()
  }
  return String(value).trim()
}

function parseDate(value: string) {
  const compact = value.match(/(20\d{2})\D?(\d{2})\D?(\d{2})/)
  if (!compact) return null
  const [, year, month, day] = compact
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
  ) return null
  return `${year}-${month}-${day}`
}

function normalizeDateOnly(value: string) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) ? parseDate(value) : null
}

function formatDate(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function positiveInteger(value: string) {
  const parsed = Number(value.replaceAll(',', ''))
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function emptyToNull(value: string) {
  const normalized = value.trim()
  return normalized || null
}

function isPurchaseItemSku(value: string) {
  return /^\d{5,}-\d+(?:[-_].+)?$/i.test(value)
}

function isReliableSupplierOrderNumber(value: string) {
  return isUniqueSupplierOrderIdentifier(value)
}

function describeHeaderProblem(sheet: ExcelJS.Worksheet) {
  let closest: { kind: EcountReportKind; matched: number; missing: string[]; rowNumber: number } | null = null
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber += 1) {
    const headers = new Set<string>()
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
      const header = normalizeHeader(cellText(cell.value))
      if (header) headers.add(header)
    })
    for (const definition of REPORT_DEFINITIONS) {
      for (const requiredHeaders of reportHeaderSignatures(definition)) {
        const missing = requiredHeaders.filter((header) => !headers.has(header))
        const matched = requiredHeaders.length - missing.length
        if (!closest || matched > closest.matched) closest = { kind: definition.kind, matched, missing, rowNumber }
      }
    }
  }
  if (!closest || closest.matched === 0) return '첫 20행에서 필요한 열 제목을 찾지 못했습니다.'
  return `가장 가까운 형식: ${reportLabel(closest.kind)}(헤더 ${closest.rowNumber}행), 누락 열: ${closest.missing.join(', ')}`
}

function reliableSupplierOrderNumber(value: string) {
  const normalized = normalizeSupplierOrderReference(value)
  return isReliableSupplierOrderNumber(normalized ?? '') ? normalized : null
}

function purchaseKey(code: string, sku: string) {
  return code && sku ? `${code}::${sku}` : null
}

function supplierKey(orderNumber: string | null, sku: string) {
  return orderNumber && isReliableSupplierOrderNumber(orderNumber) && sku
    ? `${orderNumber}::${sku}`
    : null
}

type BulkPaymentIdentity = {
  sku: string
  purchaseManagementCode: string | null
  supplierOrderNumber: string | null
}

function bulkPaymentIdentityKeys(item: BulkPaymentIdentity) {
  return [
    purchaseKey(item.purchaseManagementCode ?? '', item.sku),
    supplierKey(item.supplierOrderNumber, item.sku),
  ].map((key, index) => key ? `${index === 0 ? 'management' : 'supplier'}:${key}` : null)
    .filter((key): key is string => Boolean(key))
}

/** @internal Exported for regression coverage of raw-refresh persistence. */
export function collectBulkPaymentOverrides(rows: Array<BulkPaymentIdentity & {
  bulkPaymentPending: boolean
  bulkPaymentDueDate: string | null
  bulkPaymentDepositCny?: string | number | null
  bulkPaymentDepositKrw?: string | number | null
  bulkPaymentDepositPaidAt?: string | null
  bulkPaymentDepositMemo?: string | null
}>) {
  const overrides = new Map<string, {
    dueDate: string | null
    depositCny: string | number | null
    depositKrw: string | number | null
    depositPaidAt: string | null
    depositMemo: string | null
  }>()
  for (const row of rows) {
    if (!row.bulkPaymentPending) continue
    for (const key of bulkPaymentIdentityKeys(row)) {
      if (!overrides.has(key)) {
        overrides.set(key, {
          dueDate: row.bulkPaymentDueDate,
          depositCny: row.bulkPaymentDepositCny ?? 0,
          depositKrw: row.bulkPaymentDepositKrw ?? 0,
          depositPaidAt: row.bulkPaymentDepositPaidAt ?? null,
          depositMemo: row.bulkPaymentDepositMemo ?? null,
        })
      }
    }
  }
  return overrides
}

/** @internal Exported for regression coverage of raw-refresh persistence. */
export function applyBulkPaymentOverride(
  row: PurchaseRequestItemInsert,
  overrides: Map<string, {
    dueDate: string | null
    depositCny: string | number | null
    depositKrw: string | number | null
    depositPaidAt: string | null
    depositMemo: string | null
  }>,
): PurchaseRequestItemInsert {
  for (const key of bulkPaymentIdentityKeys({
    sku: row.sku,
    purchaseManagementCode: row.purchaseManagementCode ?? null,
    supplierOrderNumber: row.supplierOrderNumber ?? null,
  })) {
    if (!overrides.has(key)) continue
    const override = overrides.get(key)!
    return {
      ...row,
      bulkPaymentPending: true,
      bulkPaymentDueDate: override.dueDate,
      bulkPaymentDepositCny: String(override.depositCny ?? 0),
      bulkPaymentDepositKrw: String(override.depositKrw ?? 0),
      bulkPaymentDepositPaidAt: override.depositPaidAt,
      bulkPaymentDepositMemo: override.depositMemo,
    }
  }
  return row
}

function sumQuantities<T extends { quantity?: number; requestedQuantity?: number }>(items: T[]) {
  return items.reduce((total, item) => total + (item.quantity ?? item.requestedQuantity ?? 0), 0)
}

/**
 * Return only explicit SaaS-China rows with the exact stable purchase identity
 * shared by the Ecount snapshot stages. A SKU alone (or an absent management
 * code) is never enough to suppress a raw row.
 */
export function getSaasChinaProtectedPurchaseKeys(
  rows: ReadonlyArray<PurchaseManagementSkuIdentity & { rawData: unknown }>,
) {
  const keys = new Set<string>()
  for (const row of rows) {
    if (!isSaasChinaMode(row.rawData)) continue
    const key = saasChinaPurchaseKey(row)
    if (key) keys.add(key)
  }
  return keys
}

/**
 * Ecount is still authoritative for ordinary raw rows. This deliberately
 * filters only snapshot entries that name an explicitly protected SaaS row by
 * management code + SKU, so incomplete/unknown Ecount identifiers continue
 * through the normal replacement path.
 */
export function excludeSaasChinaProtectedSnapshotItems<T extends PurchaseManagementSkuIdentity>(
  items: ReadonlyArray<T>,
  protectedPurchaseKeys: ReadonlySet<string>,
) {
  return items.filter((item) => {
    const key = saasChinaPurchaseKey(item)
    return !key || !protectedPurchaseKeys.has(key)
  })
}

function saasChinaPurchaseKeysMatch(
  left: PurchaseManagementSkuIdentity,
  right: PurchaseManagementSkuIdentity,
) {
  const leftKey = saasChinaPurchaseKey(left)
  const rightKey = saasChinaPurchaseKey(right)
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}

function saasChinaPurchaseKey(input: PurchaseManagementSkuIdentity) {
  const sku = input.sku.trim()
  const purchaseManagementCode = input.purchaseManagementCode?.trim() ?? ''
  return purchaseKey(purchaseManagementCode, sku)
}

function isSaasChinaMode(rawData: unknown) {
  if (typeof rawData !== 'object' || rawData === null || !('saasChinaMode' in rawData)) {
    return false
  }
  return rawData.saasChinaMode === true
}

function readRawDataSource(rawData: unknown) {
  if (typeof rawData !== 'object' || rawData === null || !('source' in rawData)) return ''
  const source = rawData.source
  return typeof source === 'string' ? source : ''
}

function isReplaceableEcountSource(sources: readonly string[] = REPLACEABLE_ECOUNT_SOURCES) {
  const sourceList = sql.join(
    sources.map((source) => sql`${source}`),
    sql`, `,
  )
  return sql`COALESCE(${purchaseRequestItems.rawData}->>'source', '') IN (
    ${sourceList}
  )`
}

function reportLabel(kind: EcountReportKind) {
  switch (kind) {
    case 'purchaseRequest': return '발주 요청 현황'
    case 'purchasePlan': return '발주 계획 현황'
    case 'purchaseHistory': return '구매 현황'
    case 'chinaInventory': return '중국재고'
    case 'chinaOutbound': return '중국 출고'
  }
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}
