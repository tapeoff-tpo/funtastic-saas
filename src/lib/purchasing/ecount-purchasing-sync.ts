import ExcelJS from 'exceljs'
import { createHash } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  chinaWarehouseInventory,
  purchaseRequestItems,
} from '@/lib/db/schema'
import { getReflectedOutboundMatchKeys } from './reflected-outbound-items'
import { getIgnoredPurchasingItemKeys, purchasingItemIdentity } from './ignored-purchasing-items'

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
  domesticInventoryReflectedThrough: string
  purchasePlanConfirmedSince: string
  files: Record<EcountReportKind, string>
  activeRequests: EcountPendingRequest[]
  purchaseCompleted: EcountPurchaseCompletedItem[]
  chinaInventory: EcountChinaInventoryItem[]
  outboundCompleted: EcountOutboundPendingItem[]
  outboundPending: EcountOutboundPendingItem[]
  validation: {
    activeRequestRows: number
    activeRequestsMatchedToPlan: number
    activeRequestsMatchedToPurchase: number
    outboundRowsWithSupplierOrder: number
    outboundRowsMatchedToPurchase: number
    outboundRowsWithoutReliableSupplierOrder: number
  }
  warnings: string[]
}

const REPORT_DEFINITIONS: Array<{
  kind: EcountReportKind
  requiredHeaders: string[]
}> = [
  {
    kind: 'purchaseRequest',
    requiredHeaders: ['품목코드', '구입관리코드', '진행상태', '사전포장여부코드'],
  },
  {
    kind: 'purchasePlan',
    requiredHeaders: ['입고창고명', '실 구매 수량(C)', '구입관리코드', '현재상태'],
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

export async function parseEcountPurchasingSnapshot(input: {
  files: EcountPurchasingUpload[]
  domesticInventoryReflectedThrough: string
  asOfDate?: string
  purchasePlanConfirmedSince?: string
  allowMissingReports?: boolean
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

  const purchasePlanRows = readRows(purchasePlan)
    .filter((row) => isPurchaseItemSku(valueAt(row, purchasePlan, '품목코드')))
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
      const rawSupplierOrderNumber = valueAt(row, chinaOutbound, '주문서번호')
      const supplierOrderNumber = isReliableSupplierOrderNumber(rawSupplierOrderNumber)
        ? rawSupplierOrderNumber
        : null
      const supplierLegacyMatchKey = supplierOrderNumber
        ? `supplier:${supplierOrderNumber}:${sku}`
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
        supplierOrderNumber: reliableSupplierOrderNumber(valueAt(plan, purchasePlan, '주문서번호 (C)')),
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

      const supplierOrderNumber = reliableSupplierOrderNumber(valueAt(row, purchaseHistory, '주문서번호 (C)'))
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
  // Purchase-history rows already represent quantities that reached China.
  // China-outbound rows are a later stage of those same quantities, so they
  // must not consume the remaining purchase-plan quantity a second time.
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
  const outboundRowsWithSupplierOrder = rawChinaOutboundItems.filter((row) => row.supplierOrderNumber !== null)
  const outboundRowsWithPurchaseReference = rawChinaOutboundItems.filter((row) => (
    row.purchaseManagementCode !== null || row.supplierOrderNumber !== null
  ))
  const outboundRowsMatchedToPurchase = outboundRowsWithPurchaseReference.filter((row) => {
    const managementKey = row.purchaseManagementCode
      ? purchaseKey(row.purchaseManagementCode, row.sku)
      : null
    if (managementKey) return purchaseKeys.has(managementKey)
    return purchaseSupplierKeys.has(supplierKey(row.supplierOrderNumber, row.sku)!)
  }).length
  const outboundRowsWithoutReliableSupplierOrder = rawChinaOutboundItems.length - outboundRowsWithSupplierOrder.length
  const outboundRowsWithoutPurchaseReference = rawChinaOutboundItems.length - outboundRowsWithPurchaseReference.length

  const warnings: string[] = []
  if (activeRequests.length === 0) warnings.push('진행중 발주요청이 없습니다.')
  if (chinaInventoryItems.length === 0) warnings.push('중국창고 재고가 0건입니다.')
  if (outboundRowsWithoutPurchaseReference > 0) {
    warnings.push(`중국출고 ${outboundRowsWithoutPurchaseReference.toLocaleString('ko-KR')}건은 주문서번호와 구입관리코드가 없어 출고관리코드 또는 행 기준 보조키로 보관합니다.`)
  }
  if (outboundRowsWithPurchaseReference.length !== outboundRowsMatchedToPurchase) {
    warnings.push(`중국출고 구매 대조 ${outboundRowsMatchedToPurchase.toLocaleString('ko-KR')}/${outboundRowsWithPurchaseReference.length.toLocaleString('ko-KR')}건이 구매현황과 일치합니다.`)
  }

  return {
    asOfDate,
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
    chinaInventory: chinaInventoryItems,
    outboundCompleted,
    outboundPending,
    validation: {
      activeRequestRows: activeRequests.length,
      activeRequestsMatchedToPlan,
      activeRequestsMatchedToPurchase,
      outboundRowsWithSupplierOrder: outboundRowsWithSupplierOrder.length,
      outboundRowsMatchedToPurchase,
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
    // Strong identifiers define the workflow identity. Once the same supplier
    // order + SKU (or management code + SKU when an order number is missing)
    // appears in purchase history, the plan has progressed regardless of a
    // quantity discrepancy between reports.
    const strongMatch = orderedHistory.some(({ item }) => {
      if (plan.sku !== item.sku) return false
      const planOrderKey = supplierKey(plan.supplierOrderNumber, plan.sku)
      const historyOrderKey = supplierKey(item.supplierOrderNumber, item.sku)
      if (planOrderKey && historyOrderKey) return planOrderKey === historyOrderKey
      return Boolean(
        !planOrderKey
        && !historyOrderKey
        && plan.purchaseManagementCode
        && item.purchaseManagementCode
        && plan.purchaseManagementCode === item.purchaseManagementCode,
      )
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
  const orderMatches = Boolean(
    left.supplierOrderNumber
    && right.supplierOrderNumber
    && left.supplierOrderNumber === right.supplierOrderNumber,
  )
  const managementConflicts = Boolean(
    left.purchaseManagementCode
    && right.purchaseManagementCode
    && left.purchaseManagementCode !== right.purchaseManagementCode,
  )
  const orderConflicts = Boolean(
    left.supplierOrderNumber
    && right.supplierOrderNumber
    && left.supplierOrderNumber !== right.supplierOrderNumber,
  )
  // A conflicting strong identifier means these are different purchases unless
  // the other strong identifier explicitly matches. Do not merge two orders
  // merely because SKU, option, and quantity happen to be identical.
  if (managementConflicts && !orderMatches) return 0
  if (orderConflicts && !managementMatches) return 0

  const leftOption = left.optionName?.trim() ?? ''
  const rightOption = right.optionName?.trim() ?? ''
  // Order number + SKU (or management code + SKU when no order number exists)
  // is authoritative. Option labels often change between Ecount reports.
  if (!orderMatches && !managementMatches && leftOption && rightOption && leftOption !== rightOption) return 0

  let score = 10
  if (leftOption && rightOption && leftOption === rightOption) score += 10
  if (managementMatches) score += 80
  if (orderMatches) score += 100
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

export async function syncEcountPurchasingSnapshot(input: {
  userId: string
  requestedByUserId: string
  snapshot: EcountPurchasingSnapshot
  reportKinds?: EcountReportKind[]
}) {
  const reflectedOutboundMatchKeys = await getReflectedOutboundMatchKeys(input.userId)
  const ignoredPurchasingItemKeys = await getIgnoredPurchasingItemKeys(input.userId)
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)

    const {
      reportKinds,
      refreshPurchasePipeline,
      refreshOutbound,
      sourcesToReplace,
    } = getEcountPurchasingRefreshScope(input.reportKinds)
    const selectedPurchaseCompleted = (refreshPurchasePipeline ? input.snapshot.purchaseCompleted : [])
      .filter((item) => !ignoredPurchasingItemKeys.has(purchasingItemIdentity({
      source: item.source,
      sku: item.sku,
      purchaseManagementCode: item.purchaseManagementCode,
      supplierOrderNumber: item.supplierOrderNumber,
    })))
    const snapshotManagedItems = [
      ...(refreshPurchasePipeline ? input.snapshot.activeRequests : []),
      ...selectedPurchaseCompleted,
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
        return !REPLACEABLE_ECOUNT_SOURCES.includes(source as (typeof REPLACEABLE_ECOUNT_SOURCES)[number])
          && snapshotManagedItems.some((item) => (
            item.purchaseManagementCode === row.purchaseManagementCode && item.sku === row.sku
          ))
      })
      if (conflicts.length > 0) {
        throw new Error(`다른 발주 데이터와 겹치는 구입관리코드+품목이 ${conflicts.length.toLocaleString('ko-KR')}건 있습니다. 기존 행을 확인한 뒤 다시 동기화해주세요.`)
      }
    }

    const replaceableRows = await tx
      .select({ id: purchaseRequestItems.id })
      .from(purchaseRequestItems)
      .where(and(
        eq(purchaseRequestItems.userId, input.userId),
        isReplaceableEcountSource(sourcesToReplace),
      ))
    if (replaceableRows.length > 0) {
      await tx.delete(purchaseRequestItems).where(inArray(
        purchaseRequestItems.id,
        replaceableRows.map((row) => row.id),
      ))
    }

    const [{ maxRowNumber }] = await tx
      .select({ maxRowNumber: sql<number>`COALESCE(MAX(${purchaseRequestItems.rowNumber}), 0)::int` })
      .from(purchaseRequestItems)
      .where(eq(purchaseRequestItems.userId, input.userId))
    let nextRowNumber = maxRowNumber
    const now = new Date()
    const snapshotDate = new Date(`${input.snapshot.asOfDate}T00:00:00.000Z`)

    const requestRows = (refreshPurchasePipeline ? input.snapshot.activeRequests : []).map((item) => ({
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
    const purchaseCompletedRows = selectedPurchaseCompleted.map((item) => ({
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
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
    }))
    const chinaArrivedRows = (reportKinds.has('chinaInventory') ? input.snapshot.chinaInventory : []).map((item) => ({
      userId: input.userId,
      rowNumber: ++nextRowNumber,
      status: 'china_arrived' as const,
      requestDate: input.snapshot.asOfDate,
      sku: item.sku,
      productName: item.productName,
      optionName: item.optionName,
      requestedQuantity: item.quantity,
      actualPurchaseQuantity: item.quantity,
      chinaReceivedQuantity: item.quantity,
      chinaReceivedAt: snapshotDate,
      sourceCurrentState: 'Ecount China inventory',
      rawData: {
        source: ECOUNT_CHINA_ARRIVED_SOURCE,
        sourceFileName: item.sourceFileName,
        sourceRowNumber: item.sourceRowNumber,
        snapshotAsOfDate: input.snapshot.asOfDate,
        productType: item.productType,
        warehouseQuantities: item.warehouseQuantities,
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
    }))
    const outboundRows = (refreshOutbound ? input.snapshot.outboundPending : []).map((item) => ({
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
    const outboundCompletedRows = (refreshOutbound ? input.snapshot.outboundCompleted : [])
      .map((item) => removeReflectedOutboundComponents(item, reflectedOutboundMatchKeys))
      .filter((item): item is EcountOutboundPendingItem => item !== null)
      .map((item) => ({
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
    ]
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
  if (reportKinds.has('chinaInventory')) sourcesToReplace.push(ECOUNT_CHINA_ARRIVED_SOURCE)
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
      candidate.requiredHeaders.every((header) => columns.has(header))
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
  const column = report.columns.get(header)
  return column ? cellText(source.row.getCell(column).value) : ''
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
  return /^[1-9]\d{8,}$/.test(value)
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
      const missing = definition.requiredHeaders.filter((header) => !headers.has(header))
      const matched = definition.requiredHeaders.length - missing.length
      if (!closest || matched > closest.matched) closest = { kind: definition.kind, matched, missing, rowNumber }
    }
  }
  if (!closest || closest.matched === 0) return '첫 20행에서 필요한 열 제목을 찾지 못했습니다.'
  return `가장 가까운 형식: ${reportLabel(closest.kind)}(헤더 ${closest.rowNumber}행), 누락 열: ${closest.missing.join(', ')}`
}

function reliableSupplierOrderNumber(value: string) {
  const normalized = value.trim()
  return isReliableSupplierOrderNumber(normalized) ? normalized : null
}

function purchaseKey(code: string, sku: string) {
  return code && sku ? `${code}::${sku}` : null
}

function supplierKey(orderNumber: string | null, sku: string) {
  return orderNumber && isReliableSupplierOrderNumber(orderNumber) && sku
    ? `${orderNumber}::${sku}`
    : null
}

function sumQuantities<T extends { quantity?: number; requestedQuantity?: number }>(items: T[]) {
  return items.reduce((total, item) => total + (item.quantity ?? item.requestedQuantity ?? 0), 0)
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
