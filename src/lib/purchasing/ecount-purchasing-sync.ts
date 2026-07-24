import ExcelJS from 'exceljs'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  chinaWarehouseInventory,
  purchaseRequestItems,
} from '@/lib/db/schema'

export const ECOUNT_PURCHASING_LEGACY_SOURCE = 'ecount_purchasing_replacement'
export const ECOUNT_PENDING_REQUEST_SOURCE = 'ecount_purchasing_snapshot_request'
export const ECOUNT_PURCHASE_COMPLETED_SOURCE = 'ecount_purchasing_snapshot_purchase_completed'
export const ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE = 'ecount_purchasing_snapshot_plan_purchase_completed'
export const ECOUNT_CHINA_ARRIVED_SOURCE = 'ecount_purchasing_snapshot_china_arrived'
export const ECOUNT_OUTBOUND_SOURCE = 'ecount_purchasing_snapshot_outbound'
export const ECOUNT_OUTBOUND_COMPLETED_SOURCE = 'ecount_purchasing_snapshot_outbound_completed'

const REPLACEABLE_ECOUNT_SOURCES = [
  ECOUNT_PURCHASING_LEGACY_SOURCE,
  ECOUNT_PENDING_REQUEST_SOURCE,
  ECOUNT_PURCHASE_COMPLETED_SOURCE,
  ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE,
  ECOUNT_CHINA_ARRIVED_SOURCE,
  ECOUNT_OUTBOUND_SOURCE,
  ECOUNT_OUTBOUND_COMPLETED_SOURCE,
] as const

const REPORT_KINDS = [
  'purchaseRequest',
  'purchasePlan',
  'purchaseHistory',
  'chinaInventory',
  'chinaOutbound',
] as const

type EcountReportKind = (typeof REPORT_KINDS)[number]
type EcountPurchaseCompletedSource =
  | typeof ECOUNT_PURCHASE_COMPLETED_SOURCE
  | typeof ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE

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
  supplierOrderNumber: string | null
  outboundManagementCode: string | null
  fallbackMatchKey: string
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
    requiredHeaders: ['품목구분', '합계', '중국창고'],
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
  if (missingKinds.length > 0) {
    throw new Error(`필수 원본 파일이 없습니다: ${missingKinds.map(reportLabel).join(', ')}`)
  }

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

  const activeRequests = readRows(purchaseRequest)
    .filter((row) => isPurchaseItemSku(valueAt(row, purchaseRequest, '품목코드')))
    .filter((row) => valueAt(row, purchaseRequest, '진행상태') === '진행중')
    .map((row) => {
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

  const chinaInventoryItems = readRows(chinaInventory)
    .filter((row) => isChinaInventorySku(valueAt(row, chinaInventory, '품목코드')))
    .map((row) => {
      const quantity = positiveInteger(valueAt(row, chinaInventory, '중국창고'))
      const optionName = emptyToNull(valueAt(row, chinaInventory, '규격'))
      if (quantity === 0) return null

      return {
        sourceFileName: chinaInventory.fileName,
        sourceRowNumber: row.number,
        sku: valueAt(row, chinaInventory, '품목코드'),
        productName: valueAt(row, chinaInventory, '품목명'),
        optionName,
        optionKey: optionName ?? '',
        productType: emptyToNull(valueAt(row, chinaInventory, '품목구분')),
        quantity,
      } satisfies EcountChinaInventoryItem
    })
    .filter((row): row is EcountChinaInventoryItem => row !== null)

  const chinaOutboundItems = readRows(chinaOutbound)
    .filter((row) => isPurchaseItemSku(valueAt(row, chinaOutbound, '품목코드')))
    .map((row) => {
      const effectiveDate = parseDate(valueAt(row, chinaOutbound, '유효기간'))
      const quantity = positiveInteger(valueAt(row, chinaOutbound, '출고수량(EA)'))
      if (!effectiveDate || quantity === 0) return null

      const sku = valueAt(row, chinaOutbound, '품목코드')
      const sourceDateNo = valueAt(row, chinaOutbound, '일자-No.')
      const outboundManagementCode = emptyToNull(valueAt(row, chinaOutbound, '출고관리코드'))
      const rawSupplierOrderNumber = valueAt(row, chinaOutbound, '주문서번호')
      const supplierOrderNumber = isReliableSupplierOrderNumber(rawSupplierOrderNumber)
        ? rawSupplierOrderNumber
        : null
      const fallbackMatchKey = supplierOrderNumber
        ? `supplier:${supplierOrderNumber}:${sku}`
        : outboundManagementCode
          ? `outbound:${outboundManagementCode}:${sku}`
          : `row:${sourceDateNo}:${sku}:${row.number}`

      return {
        sourceFileName: chinaOutbound.fileName,
        sourceRowNumber: row.number,
        sourceDateNo,
        effectiveDate,
        sku,
        productName: valueAt(row, chinaOutbound, '품목명'),
        optionName: emptyToNull(valueAt(row, chinaOutbound, '규격')),
        quantity,
        supplierOrderNumber,
        outboundManagementCode,
        fallbackMatchKey,
      } satisfies EcountOutboundPendingItem
    })
    .filter((row): row is EcountOutboundPendingItem => row !== null)

  const outboundCompleted = chinaOutboundItems.filter((row) => row.effectiveDate <= reflectedThrough)
  const outboundPending = chinaOutboundItems.filter((row) => row.effectiveDate > reflectedThrough)

  // The plan is the current stage record. Purchase history is only a fallback when no live plan remains.
  const purchaseCompletedFromPlan: EcountPurchaseCompletedItem[] = []
  const handledPlanPurchaseKeys = new Set<string>()
  for (const request of readRows(purchaseRequest)) {
    const sku = valueAt(request, purchaseRequest, '품목코드')
    if (!isPurchaseItemSku(sku) || valueAt(request, purchaseRequest, '진행상태') !== '완료') continue

    const purchaseManagementCode = valueAt(request, purchaseRequest, '구입관리코드')
    const matchKey = purchaseKey(purchaseManagementCode, sku)
    const requestDate = parseDate(valueAt(request, purchaseRequest, '일자-No.'))
    const chinaArrivalRequestDate = parseDate(valueAt(request, purchaseRequest, '중국창고 도착요청일'))
    if (
      !matchKey
      || handledPlanPurchaseKeys.has(matchKey)
      || !requestDate
      || !chinaArrivalRequestDate
    ) continue

    const matchingPlanRows = planRowsByPurchaseKey.get(matchKey) ?? []
    if (matchingPlanRows.length !== 1) continue
    const plan = matchingPlanRows[0]
    const sourceQuantity = positiveInteger(valueAt(plan, purchasePlan, '실 구매 수량(C)'))
    const supplierOrderNumber = emptyToNull(valueAt(plan, purchasePlan, '주문서번호 (C)'))
    handledPlanPurchaseKeys.add(matchKey)
    if (sourceQuantity === 0) continue

    purchaseCompletedFromPlan.push({
      source: ECOUNT_PURCHASE_PLAN_COMPLETED_SOURCE,
      sourceFileName: purchasePlan.fileName,
      sourceRowNumber: plan.number,
      sourceDateNo: valueAt(plan, purchasePlan, '일자-No.'),
      sourceRequestFileName: purchaseRequest.fileName,
      sourceRequestRowNumber: request.number,
      purchaseDate: requestDate,
      sku,
      productName: valueAt(plan, purchasePlan, '품목명') || valueAt(request, purchaseRequest, '품목명'),
      optionName: emptyToNull(valueAt(plan, purchasePlan, '규격'))
        ?? emptyToNull(valueAt(request, purchaseRequest, '규격')),
      quantity: sourceQuantity,
      chinaArrivalRequestDate,
      purchaseManagementCode,
      purchaseOrderNumber: null,
      supplierOrderNumber,
      purchaseMethod: emptyToNull(valueAt(plan, purchasePlan, '구매진행여부 (C)')),
      unitPriceCny: null,
      shippingFeeCny: null,
    })
  }
  const purchaseCompletedFromHistory = readRows(purchaseHistory)
    .filter((row) => isPurchaseItemSku(valueAt(row, purchaseHistory, '품목코드')))
    .filter((row) => valueAt(row, purchaseHistory, '진행상태') === '확인')
    .map((row) => {
      const sku = valueAt(row, purchaseHistory, '품목코드')
      const sourceQuantity = positiveInteger(valueAt(row, purchaseHistory, '구매수량(EA)'))
      const purchaseManagementCode = emptyToNull(valueAt(row, purchaseHistory, '구입관리코드'))
      const planMatchKey = purchaseKey(purchaseManagementCode ?? '', sku)
      const chinaArrivalRequestDate = parseDate(valueAt(row, purchaseHistory, '중국창고 도착요청일'))
      if (
        sourceQuantity === 0
        || !chinaArrivalRequestDate
        || chinaArrivalRequestDate <= asOfDate
        || (planMatchKey && handledPlanPurchaseKeys.has(planMatchKey))
      ) return null

      const supplierOrderNumber = emptyToNull(valueAt(row, purchaseHistory, '주문서번호 (C)'))
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
      } satisfies EcountPurchaseCompletedItem
    })
    .filter((row): row is EcountPurchaseCompletedItem => row !== null)
  const purchaseCompleted = reconcilePurchaseCompletedWithOutbound(
    [...purchaseCompletedFromHistory, ...purchaseCompletedFromPlan],
    chinaOutboundItems,
  )

  const activeRequestsMatchedToPlan = activeRequests.filter((row) => planKeys.has(
    purchaseKey(row.purchaseManagementCode, row.sku)!,
  )).length
  const activeRequestsMatchedToPurchase = activeRequests.filter((row) => purchaseKeys.has(
    purchaseKey(row.purchaseManagementCode, row.sku)!,
  )).length
  const outboundRowsWithSupplierOrder = outboundPending.filter((row) => row.supplierOrderNumber !== null)
  const outboundRowsMatchedToPurchase = outboundRowsWithSupplierOrder.filter((row) => purchaseSupplierKeys.has(
    supplierKey(row.supplierOrderNumber, row.sku)!,
  )).length
  const outboundRowsWithoutReliableSupplierOrder = outboundPending.length - outboundRowsWithSupplierOrder.length

  const warnings: string[] = []
  if (activeRequests.length === 0) warnings.push('진행중 발주요청이 없습니다.')
  if (chinaInventoryItems.length === 0) warnings.push('중국창고 재고가 0건입니다.')
  if (outboundRowsWithoutReliableSupplierOrder > 0) {
    warnings.push(`중국출고 ${outboundRowsWithoutReliableSupplierOrder.toLocaleString('ko-KR')}건은 주문서번호가 없어 출고관리코드 또는 행 기준 보조키로 보관합니다.`)
  }
  if (outboundRowsWithSupplierOrder.length !== outboundRowsMatchedToPurchase) {
    warnings.push(`중국출고 주문서번호 대조 ${outboundRowsMatchedToPurchase.toLocaleString('ko-KR')}/${outboundRowsWithSupplierOrder.toLocaleString('ko-KR')}건이 구매현황과 일치합니다.`)
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

function reconcilePurchaseCompletedWithOutbound(
  purchaseItems: EcountPurchaseCompletedItem[],
  outboundItems: EcountOutboundPendingItem[],
) {
  const remainingOutboundQuantity = new Map<number, number>(
    outboundItems.map((item, index) => [index, item.quantity]),
  )
  const orderedOutbound = outboundItems
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (
      left.item.effectiveDate.localeCompare(right.item.effectiveDate)
      || left.item.sourceRowNumber - right.item.sourceRowNumber
      || left.index - right.index
    ))
  const orderedPurchases = purchaseItems
    .map((item, index) => ({ item, index }))
    .sort((left, right) => (
      (left.item.purchaseDate ?? '9999-12-31').localeCompare(right.item.purchaseDate ?? '9999-12-31')
      || left.item.sourceRowNumber - right.item.sourceRowNumber
      || left.index - right.index
    ))
  const remainingPurchaseQuantity = new Map<number, number>()

  const consumeOutbound = (
    quantity: number,
    matches: (outbound: EcountOutboundPendingItem) => boolean,
  ) => {
    let remaining = quantity
    for (const { item: outbound, index } of orderedOutbound) {
      if (remaining === 0 || !matches(outbound)) continue
      const outboundRemaining = remainingOutboundQuantity.get(index) ?? 0
      const allocated = Math.min(remaining, outboundRemaining)
      if (allocated === 0) continue
      remainingOutboundQuantity.set(index, outboundRemaining - allocated)
      remaining -= allocated
    }
    return remaining
  }

  for (const { item: purchase, index } of orderedPurchases) {
    let remaining = purchase.quantity
    const exactSupplierKey = supplierKey(purchase.supplierOrderNumber, purchase.sku)
    if (exactSupplierKey) {
      remaining = consumeOutbound(
        remaining,
        (outbound) => (
          outbound.effectiveDate >= (purchase.purchaseDate ?? '')
          && supplierKey(outbound.supplierOrderNumber, outbound.sku) === exactSupplierKey
        ),
      )
    }

    // China outbound reports often omit the supplier order number. In that case,
    // the SKU is variant-level, so consume only later outbound rows in FIFO order.
    if (remaining > 0 && purchase.purchaseDate) {
      const purchaseDate = purchase.purchaseDate
      remaining = consumeOutbound(
        remaining,
        (outbound) => (
          outbound.supplierOrderNumber === null
          && outbound.sku === purchase.sku
          && outbound.effectiveDate >= purchaseDate
        ),
      )
    }
    remainingPurchaseQuantity.set(index, remaining)
  }

  return purchaseItems.flatMap((item, index) => {
    const quantity = remainingPurchaseQuantity.get(index) ?? item.quantity
    return quantity > 0 ? [{ ...item, quantity }] : []
  })
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
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ecount-purchasing-sync:${input.userId}`}))`)

    const snapshotManagedItems = [
      ...input.snapshot.activeRequests,
      ...input.snapshot.purchaseCompleted,
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
        isReplaceableEcountSource(),
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

    const requestRows = input.snapshot.activeRequests.map((item) => ({
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
    const purchaseCompletedRows = input.snapshot.purchaseCompleted.map((item) => ({
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
      unitPriceCny: item.unitPriceCny,
      shippingFeeCny: item.shippingFeeCny,
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
    const chinaArrivedRows = input.snapshot.chinaInventory.map((item) => ({
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
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
    }))
    const outboundRows = input.snapshot.outboundPending.map((item) => ({
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
      supplierOrderNumber: item.supplierOrderNumber,
      outboundExpectedDate: item.effectiveDate,
      rawData: {
        source: ECOUNT_OUTBOUND_SOURCE,
        sourceFileName: item.sourceFileName,
        sourceRowNumber: item.sourceRowNumber,
        sourceDateNo: item.sourceDateNo,
        effectiveDate: item.effectiveDate,
        outboundManagementCode: item.outboundManagementCode,
        fallbackMatchKey: item.fallbackMatchKey,
        outboundRequestedQuantity: item.quantity,
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
    }))
    const outboundCompletedRows = input.snapshot.outboundCompleted.map((item) => ({
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
      supplierOrderNumber: item.supplierOrderNumber,
      outboundExpectedDate: item.effectiveDate,
      purchaseConfirmed: true,
      rawData: {
        source: ECOUNT_OUTBOUND_COMPLETED_SOURCE,
        sourceFileName: item.sourceFileName,
        sourceRowNumber: item.sourceRowNumber,
        sourceDateNo: item.sourceDateNo,
        effectiveDate: item.effectiveDate,
        outboundManagementCode: item.outboundManagementCode,
        fallbackMatchKey: item.fallbackMatchKey,
        outboundCompletedQuantity: item.quantity,
        syncedByUserId: input.requestedByUserId,
        syncedAt: now.toISOString(),
      },
    }))

    for (const rows of chunks([
      ...requestRows,
      ...purchaseCompletedRows,
      ...chinaArrivedRows,
      ...outboundRows,
      ...outboundCompletedRows,
    ], 500)) {
      await tx.insert(purchaseRequestItems).values(rows)
    }

    await tx
      .update(chinaWarehouseInventory)
      .set({
        totalQuantity: 0,
        availableQuantity: 0,
        lastArrivedAt: null,
        lastOutboundRequestedAt: null,
        updatedAt: now,
      })
      .where(eq(chinaWarehouseInventory.userId, input.userId))

    for (const rows of chunks(input.snapshot.chinaInventory, 500)) {
      await tx
        .insert(chinaWarehouseInventory)
        .values(rows.map((item) => ({
          userId: input.userId,
          sku: item.sku,
          productName: item.productName,
          optionKey: item.optionKey,
          optionName: item.optionName,
          totalQuantity: item.quantity,
          availableQuantity: item.quantity,
          updatedAt: now,
        })))
        .onConflictDoUpdate({
          target: [
            chinaWarehouseInventory.userId,
            chinaWarehouseInventory.sku,
            chinaWarehouseInventory.optionKey,
          ],
          set: {
            productName: sql`excluded.product_name`,
            optionName: sql`excluded.option_name`,
            totalQuantity: sql`excluded.total_quantity`,
            availableQuantity: sql`excluded.available_quantity`,
            lastArrivedAt: null,
            lastOutboundRequestedAt: null,
            updatedAt: now,
          },
        })
    }

    return {
      replacedPurchaseRows: replaceableRows.length,
      createdPendingRequestRows: requestRows.length,
      createdPurchaseCompletedRows: purchaseCompletedRows.length,
      createdChinaArrivedRows: chinaArrivedRows.length,
      createdOutboundRows: outboundRows.length,
      createdOutboundCompletedRows: outboundCompletedRows.length,
      syncedChinaInventoryRows: input.snapshot.chinaInventory.length,
      chinaInventoryQuantity: sumQuantities(input.snapshot.chinaInventory),
    }
  })
}

async function loadEcountReport(input: EcountPurchasingUpload): Promise<ParsedReport> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(input.fileBuffer) as unknown as ExcelJS.Buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error(`${input.fileName}: 시트를 찾을 수 없습니다.`)

  const header = findReportHeader(sheet)
  if (!header) {
    throw new Error(`${input.fileName}: 지원하는 Ecount 발주 원본 양식을 찾지 못했습니다.`)
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

function isChinaInventorySku(value: string) {
  return isPurchaseItemSku(value) || /^\d{3,5}$/.test(value)
}

function isReliableSupplierOrderNumber(value: string) {
  return /^[1-9]\d{8,}$/.test(value)
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

function isReplaceableEcountSource() {
  const sourceList = sql.join(
    REPLACEABLE_ECOUNT_SOURCES.map((source) => sql`${source}`),
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
