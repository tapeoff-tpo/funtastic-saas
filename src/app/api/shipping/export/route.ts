/**
 * GET /api/shipping/export
 *
 * Export orders to Excel format (carrier-specific or order-list).
 * Returns downloadable .xlsx file.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, orderItems, shipments, marketplaceConnections, products, inventory } from '@/lib/db/schema'
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { exportToCarrierExcel } from '@/lib/shipping/excel/export'
import { exportOrdersToExcel } from '@/lib/shipping/excel/order-export'
import { getCarrierTemplateById, getCarrierTemplates } from '@/lib/shipping/template-queries'
import { AVAILABLE_ORDER_FIELDS } from '@/lib/shipping/excel/templates'
import { expandOrderItemsWithMapping } from '@/lib/orders/mapping-expand'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { resolveMarketplaceDisplayName } from '@/lib/marketplace/collect-options'
import { getCombinedShipmentGroupIds } from '@/lib/shipping/combined-safety'
import { getOrderIds } from '@/lib/orders/queries'
import { ORDER_STATUS_LABELS, type ClaimType, type OrderFilters, type OrderStatus } from '@/lib/orders/types'
import { primaryPhone, secondaryPhone } from '@/lib/orders/phone-normalize'
import { normalizeShippingAddress } from '@/lib/orders/shipping-address'

export const runtime = 'nodejs'
export const maxDuration = 300

const FILTERED_EXPORT_LIMIT = 50000
const SCAN_FILTER_STATUSES = new Set(['preparing', 'ready', 'shipped'])

function parseKstDateBoundary(value: string, boundary: 'start' | 'end'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value)
  const time = boundary === 'start' ? '00:00:00.000' : '23:59:59.999'
  return new Date(`${value}T${time}+09:00`)
}

function getKstDateParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

function formatKstDate(date: Date): string {
  const parts = getKstDateParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function formatDateTimeMinute(date: Date): string {
  const parts = getKstDateParts(date)
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

function parseCommaFilter(value: string | null): string[] {
  if (!value) return []
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}

function parseStatusFilter(value: string | null): OrderStatus[] {
  if (!value) return []
  const validStatuses = new Set(Object.keys(ORDER_STATUS_LABELS))
  return value
    .split(',')
    .map((status) => status.trim())
    .filter((status): status is OrderStatus => validStatuses.has(status))
}

function parseBooleanParam(value: string | null): boolean {
  return value === 'true' || value === '1'
}

function parseSalesFeePercent(value: unknown): number | null {
  const percent = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.trim())
      : NaN
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null
}

function calculateSalesFeeAmount(amount: unknown, percent: number | null): number | '' {
  if (percent === null) return ''
  const numericAmount = typeof amount === 'number'
    ? amount
    : typeof amount === 'string'
      ? Number(amount.replace(/,/g, '').trim())
      : NaN
  if (!Number.isFinite(numericAmount)) return ''
  return Math.round(numericAmount * (percent / 100))
}

function buildFilteredExportFilters(searchParams: URLSearchParams, userId: string): OrderFilters {
  const selectedStatuses = parseStatusFilter(searchParams.get('status'))
  const singleStatus = selectedStatuses.length === 1 ? selectedStatuses[0] : undefined
  const multipleStatuses = selectedStatuses.length > 1 ? selectedStatuses : undefined
  const selectedMarketplaces = parseCommaFilter(searchParams.get('marketplace'))
  const singleMarketplace = selectedMarketplaces.length === 1 ? selectedMarketplaces[0] : undefined
  const multipleMarketplaces = selectedMarketplaces.length > 1 ? selectedMarketplaces : undefined
  const claimTypeParam = searchParams.get('claimType')
  const claimType = claimTypeParam === 'cancel' || claimTypeParam === 'return' || claimTypeParam === 'exchange'
    ? claimTypeParam as ClaimType
    : undefined
  const mappingParam = searchParams.get('mapping')
  const scanParam = searchParams.get('scan')
  const scanResultParam = searchParams.get('scanResult')
  const cancelTab = parseBooleanParam(searchParams.get('cancel'))
  const held = parseBooleanParam(searchParams.get('held'))
  const isScanFilterTab = selectedStatuses.length > 0 && selectedStatuses.every((status) => SCAN_FILTER_STATUSES.has(status))

  return {
    page: 1,
    pageSize: FILTERED_EXPORT_LIMIT,
    userId,
    status: singleStatus,
    statuses: multipleStatuses,
    marketplace: singleMarketplace,
    marketplaces: multipleMarketplaces,
    carrierId: searchParams.get('carrier') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    searchField: searchParams.get('searchField') as OrderFilters['searchField'] ?? undefined,
    orderSource: (searchParams.get('orderSource') === 'saas' || searchParams.get('orderSource') === 'sabangnet')
      ? searchParams.get('orderSource') as OrderFilters['orderSource']
      : undefined,
    dateField: searchParams.get('dateField') as OrderFilters['dateField'] ?? undefined,
    dateFrom: searchParams.get('dateFrom') ?? undefined,
    dateTo: searchParams.get('dateTo') ?? undefined,
    sort: searchParams.get('sort') ?? undefined,
    order: searchParams.get('order') === 'asc' || searchParams.get('order') === 'desc'
      ? searchParams.get('order') as 'asc' | 'desc'
      : undefined,
    claimType,
    mapping: mappingParam === 'mapped' || mappingParam === 'unmapped' ? mappingParam : undefined,
    scan: isScanFilterTab && (scanParam === 'scanned' || scanParam === 'unscanned') ? scanParam : undefined,
    scanResult: isScanFilterTab && (scanResultParam === 'ok' || scanResultParam === 'duplicate' || scanResultParam === 'not_found') ? scanResultParam : undefined,
    isHeld: held || undefined,
    excludeHeld: !held && Boolean(searchParams.get('status') || claimType || cancelTab),
    cancelTab: cancelTab || undefined,
    excludeClaimLikeOrders: Boolean(searchParams.get('status')) && !claimType && !cancelTab && !held,
  }
}

function getMarketplaceExportName(order: typeof orders.$inferSelect): string {
  const rawData = order.rawData
  if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
    const data = rawData as {
      mallName?: unknown
      empSiteName?: unknown
      SiteName?: unknown
      siteName?: unknown
    }
    const candidates = [data.mallName, data.empSiteName, data.SiteName, data.siteName]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const trimmed = candidate.trim()
      if (trimmed) return resolveMarketplaceDisplayName(order.marketplaceId, trimmed)
    }
  }

  return resolveMarketplaceDisplayName(order.marketplaceId)
}

function getSalesStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: '신규주문',
    confirmed: '주문확인',
    preparing: '출고대기',
    ready: '출고대기',
    shipped: '출고완료',
    delivering: '배송중',
    delivered: '배송완료',
    cancelled: '취소',
  }
  return labels[status] ?? status
}

interface ExportRequestBody {
  orderIds?: unknown
  scope?: unknown
  type?: unknown
  templateId?: unknown
  columns?: unknown
  filters?: unknown
}

function stringBodyValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function orderIdsFromBody(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)))
}

function canUseFastShippedExportPath(searchParams: URLSearchParams): boolean {
  if (searchParams.get('dateField') !== 'shippedAt') return false
  if (!searchParams.get('dateFrom') && !searchParams.get('dateTo')) return false

  const status = searchParams.get('status')
  const statuses = searchParams.get('statuses')
  const allowedStatuses = new Set(['shipped', 'delivering', 'delivered'])
  if (status && !allowedStatuses.has(status)) return false
  if (statuses && statuses.split(',').some((item) => !allowedStatuses.has(item.trim()))) return false

  const hasMeaningfulFilter = (key: string): boolean => {
    const value = searchParams.get(key)?.trim()
    return Boolean(value && value !== 'all' && value !== 'false' && value !== '0')
  }
  const unsupportedFilters = ['marketplace', 'marketplaces', 'carrier', 'search', 'claimType', 'scan', 'scanResult']
  if (unsupportedFilters.some(hasMeaningfulFilter)) return false

  const orderSource = searchParams.get('orderSource')?.trim()
  if (orderSource === 'saas' || orderSource === 'sabangnet') return false

  const mapping = searchParams.get('mapping')?.trim()
  if (mapping === 'mapped' || mapping === 'unmapped') return false

  const searchField = searchParams.get('searchField')?.trim()
  if (searchField && searchField !== 'all') return false

  return !hasMeaningfulFilter('held') && !hasMeaningfulFilter('isHeld') && !hasMeaningfulFilter('cancelTab')
}

async function getFastShippedExportOrderIds(
  searchParams: URLSearchParams,
  userId: string,
  limit: number,
): Promise<{ ids: string[]; total: number }> {
  const conditions = [
    eq(orders.userId, userId),
    isNotNull(shipments.shippedAt),
  ]
  const status = searchParams.get('status')
  const statuses = searchParams.get('statuses')?.split(',').map((item) => item.trim()).filter(Boolean)
  if (status) {
    conditions.push(eq(orders.status, status as typeof orders.$inferSelect.status))
  } else if (statuses?.length) {
    conditions.push(inArray(orders.status, statuses as Array<typeof orders.$inferSelect.status>))
  } else {
    conditions.push(inArray(orders.status, ['shipped', 'delivering', 'delivered']))
  }

  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')
  if (dateFrom) conditions.push(gte(shipments.shippedAt, parseKstDateBoundary(dateFrom, 'start')))
  if (dateTo) conditions.push(lte(shipments.shippedAt, parseKstDateBoundary(dateTo, 'end')))

  const rows = await db
    .selectDistinct({ id: orders.id })
    .from(shipments)
    .innerJoin(orders, eq(shipments.orderId, orders.id))
    .where(and(...conditions))
    .limit(limit + 1)

  return {
    ids: rows.slice(0, limit).map((row) => row.id),
    total: rows.length > limit ? limit + 1 : rows.length,
  }
}

async function handleExportRequest(request: NextRequest, body: ExportRequestBody = {}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const searchParams = new URLSearchParams(request.nextUrl.searchParams)
  if (body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)) {
    for (const [key, value] of Object.entries(body.filters)) {
      if (typeof value === 'string') searchParams.set(key, value)
    }
  }
  const orderIdsParam = searchParams.get('orderIds')
  const bodyOrderIds = orderIdsFromBody(body.orderIds)
  const scope = stringBodyValue(body.scope) ?? searchParams.get('scope')
  const type = stringBodyValue(body.type) ?? searchParams.get('type') ?? 'carrier'
  const templateId = stringBodyValue(body.templateId) ?? searchParams.get('templateId')
  const columnsParam = stringBodyValue(body.columns) ?? searchParams.get('columns')

  try {
    let orderIds = bodyOrderIds.length > 0
      ? bodyOrderIds
      : orderIdsParam?.split(',').map((id) => id.trim()).filter(Boolean) ?? []
    if (scope === 'filtered') {
      const filtered = canUseFastShippedExportPath(searchParams)
        ? await getFastShippedExportOrderIds(searchParams, workspaceUserId, FILTERED_EXPORT_LIMIT)
        : await getOrderIds(buildFilteredExportFilters(searchParams, workspaceUserId), FILTERED_EXPORT_LIMIT)
      if (filtered.total > FILTERED_EXPORT_LIMIT) {
        return NextResponse.json(
          { error: `검색 결과가 ${FILTERED_EXPORT_LIMIT.toLocaleString('ko-KR')}건을 초과합니다. 조건을 더 좁혀서 다운로드해 주세요.` },
          { status: 400 },
        )
      }
      orderIds = filtered.ids
    }

    if (orderIds.length === 0) {
      return NextResponse.json(
        { error: '다운로드할 주문이 없습니다.' },
        { status: 400 },
      )
    }

    // Fetch orders with items and shipment data
    const [orderRows, itemRows, shipmentRows, groupIdByOrder] = await Promise.all([
      db.select().from(orders).where(and(inArray(orders.id, orderIds), eq(orders.userId, workspaceUserId))),
      db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)),
      db.select().from(shipments).where(inArray(shipments.orderId, orderIds)),
      getCombinedShipmentGroupIds(workspaceUserId, orderIds),
    ])

    // 쇼핑몰 displayName lookup (보내는분성명 = 쇼핑몰명)
    const connectionIds = [...new Set(orderRows.map((o) => o.connectionId).filter(Boolean) as string[])]
    const connectionRows = connectionIds.length > 0
      ? await db
          .select({
            id: marketplaceConnections.id,
            displayName: marketplaceConnections.displayName,
            metadata: marketplaceConnections.metadata,
          })
          .from(marketplaceConnections)
          .where(inArray(marketplaceConnections.id, connectionIds))
      : []
    const connectionMap = new Map(connectionRows.map((c) => [c.id, c.displayName]))
    const salesExportMarketplaceIdMap = new Map(connectionRows.map((connection) => [
      connection.id,
      typeof connection.metadata?.salesExportMarketplaceId === 'string'
        ? connection.metadata.salesExportMarketplaceId
        : '',
    ]))
    const salesFeePercentMap = new Map(connectionRows.map((connection) => [
      connection.id,
      parseSalesFeePercent(connection.metadata?.salesFeePercent),
    ]))

    // Phase C 매핑코드 확장: orderItems → mapping_components 의 SKU 행으로 전개.
    // 매핑 없으면 orderItems.sku 를 그대로 사용 (fallback).
    const expanded = await expandOrderItemsWithMapping(
      workspaceUserId,
      orderRows.map((o) => ({ id: o.id, marketplaceId: o.marketplaceId, rawData: o.rawData })),
      itemRows,
    )
    const expandedByOrder = new Map<string, typeof expanded>()
    for (const row of expanded) {
      const list = expandedByOrder.get(row.orderId) ?? []
      list.push(row)
      expandedByOrder.set(row.orderId, list)
    }
    const itemRowsByOrder = new Map<string, typeof itemRows>()
    for (const item of itemRows) {
      const list = itemRowsByOrder.get(item.orderId) ?? []
      list.push(item)
      itemRowsByOrder.set(item.orderId, list)
    }
    const shipmentByOrder = new Map(shipmentRows.map((shipment) => [shipment.orderId, shipment]))

    // SKU 기준 products(원가) + inventory(현재고/로케이션/확정옵션명) lookup —
    // 매핑 확장 후 행들의 SKU 까지 모두 포함해야 함.
    const skuSet = [
      ...new Set([
        ...itemRows.map((i) => i.sku).filter(Boolean) as string[],
        ...expanded.map((r) => r.sku).filter(Boolean),
      ]),
    ]
    const [productRows, inventoryRows] = skuSet.length > 0
      ? await Promise.all([
          db
            .select({ sku: products.internalSku, location: products.warehouseLocation, costPrice: products.costPrice })
            .from(products)
            .where(and(eq(products.userId, workspaceUserId), inArray(products.internalSku, skuSet))),
          db
            .select({
              sku: inventory.sku,
              stock: sql<number>`COALESCE(SUM(${inventory.availableStock}), 0)::int`,
              sectorCode: sql<string | null>`MAX(${inventory.sectorCode})`,
              packagingUnit: sql<string | null>`MAX(${inventory.packagingUnit})`,
              optionName: sql<string | null>`MAX(${inventory.optionName})`,
            })
            .from(inventory)
            .where(and(eq(inventory.userId, workspaceUserId), inArray(inventory.sku, skuSet)))
            .groupBy(inventory.sku),
        ])
      : [[], []]
    const productMap = new Map(productRows.map((p) => [p.sku, { location: p.location, costPrice: p.costPrice }]))
    const inventoryMap = new Map(
      inventoryRows.map((i) => [
        i.sku,
        { stock: i.stock, sectorCode: i.sectorCode, packagingUnit: i.packagingUnit, optionName: i.optionName },
      ]),
    )

    // 셀러 고정값은 이제 carrier_templates.columns[].fixedValue 로 관리
    // (boxCount, freightType, baseFreight, senderPhone, senderAddress 등)

    const isSalesCheckTemplate = type !== 'order-list' && templateId === 'builtin:sales-check'

    // Build flat order records for export. 매출확인용은 구성 상품별 실 출고 행을 보존한다.
    const exportData: Record<string, unknown>[] = orderRows.flatMap((order) => {
      const items = itemRowsByOrder.get(order.id) ?? []
      const shipment = shipmentByOrder.get(order.id)
      const expandedRows = expandedByOrder.get(order.id) ?? []
      const shipmentGroupId = groupIdByOrder.get(order.id) ?? null
      const isCombinedShipment = shipmentGroupId !== null

      // 매핑 전 원본 (수집상품명/수집옵션명 용)
      const rawFirst = items[0]
      const salesFeePercent = order.connectionId
        ? salesFeePercentMap.get(order.connectionId) ?? null
        : null
      const salesDiscountAndFee = calculateSalesFeeAmount(order.totalAmount, salesFeePercent)

      const marketplaceName = getMarketplaceExportName(order)
      const collectedDate = order.collectedAt ? new Date(order.collectedAt) : null
      const shippedDate = shipment?.shippedAt ? new Date(shipment.shippedAt) : null
      const exportRows = isSalesCheckTemplate && expandedRows.length > 0
        ? expandedRows
        : [expandedRows[0]]

      return exportRows.map((primary, index) => {
        // 매핑된 행이면 내부 SKU + 확정 상품명/옵션, 미매핑이면 수집 원본 fallback.
        const productName = primary?.productName ?? rawFirst?.productName ?? ''
        const sku: string = primary?.sku ?? rawFirst?.sku ?? ''
        const isConfirmedInternalRow = Boolean(
          primary?.fromMapping || (sku && (inventoryMap.has(sku) || productMap.has(sku))),
        )
        const confirmedValue = (value: string) => (
          isSalesCheckTemplate && !isConfirmedInternalRow ? '' : value
        )
        const optionText = confirmedValue(primary?.optionText ?? '')
        const isAdditionalComponent = isSalesCheckTemplate && index > 0
        const salesValue = (value: unknown) => isAdditionalComponent ? 0 : value
        const shippingAddress = order.shippingAddress && typeof order.shippingAddress === 'object'
          ? normalizeShippingAddress(order.shippingAddress as { zipCode?: string | null; address1?: string | null; address2?: string | null })
          : order.shippingAddress

        return {
        // 사용자 노출용 8자리 내부 주문번호
        orderId: order.internalNo,
        internalNo: order.internalNo,
        marketplaceOrderId: order.marketplaceOrderId,
        shipmentGroupId,
        isCombinedShipment,
        // 마켓 상품코드 — 쿠팡 vendorItemId / 네이버 productOrderId / Cafe24 item_no 등
        marketplaceItemId: rawFirst?.marketplaceItemId ?? '',
        marketplaceId: marketplaceName,
        marketplaceName,
        marketplaceCode: order.marketplaceId,
        salesExportMarketplaceId: order.connectionId ? salesExportMarketplaceIdMap.get(order.connectionId) ?? '' : '',
        marketplaceStatus: order.marketplaceStatus ?? order.status,
        buyerName: order.buyerName,
        // 기본 '구매자연락처' = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        buyerPhone: primaryPhone(order.buyerPhone2, order.buyerPhone),
        recipientName: order.recipientName,
        // 기본 '수령인연락처' = 휴대폰(phone2) 우선, 없으면 일반전화(phone1)
        recipientPhone: primaryPhone(order.recipientPhone2, order.recipientPhone),
        shippingAddress,
        productName: confirmedValue(productName),
        optionText,
        quantity: isSalesCheckTemplate
          ? primary?.quantity ?? items.reduce((sum, item) => sum + item.quantity, 0)
          : expandedRows.length > 0
            ? expandedRows.reduce((sum, r) => sum + r.quantity, 0)
            : items.reduce((sum, item) => sum + item.quantity, 0),
        unitPrice: rawFirst?.unitPrice ?? '0',
        totalAmount: order.totalAmount,
        trackingNumber: shipment?.trackingNumber ?? '',
        carrierName: shipment?.carrierName ?? '',
        orderedAt: order.orderedAt,
        status: order.status,
        // ─ 발주서 양식용 확장 필드 ─
        logisticsMessage: order.logisticsMessage ?? '',
        productCode: confirmedValue(sku),
        productPlusOption: optionText ? `${confirmedValue(productName)} [${optionText}]` : confirmedValue(productName),
        collectedProductName: rawFirst?.productName ?? '',
        collectedOption: rawFirst?.optionText ?? '',
        stock: sku ? inventoryMap.get(sku)?.stock ?? '' : '',
        // 위치 = 로케이션(inventory.sectorCode). 창고명(products.warehouseLocation)이 아니다.
        location: sku ? inventoryMap.get(sku)?.sectorCode ?? '' : '',
        costPrice: sku ? productMap.get(sku)?.costPrice ?? '' : '',
        // 피킹위치 (inventory.sectorCode) — 출력항목 '피킹위치'
        pickingLocation: sku ? inventoryMap.get(sku)?.sectorCode ?? '' : '',
        // 포장 박스 종류 (inventory.packagingUnit) — 출력항목 '포장'
        packaging: sku ? inventoryMap.get(sku)?.packagingUnit ?? '' : '',
        senderName: marketplaceName || (order.connectionId ? connectionMap.get(order.connectionId) ?? '' : ''),
        // 배송메세지 — 구매자가 마켓에서 입력한 배송 요청 (쿠팡 parcelPrintMessage 등)
        deliveryMessage: order.deliveryMessage ?? '',
        // 명시적 phone2 (휴대폰) 출력항목 — migration 020 이후 DB 에 직접 저장됨
        recipientPhone2: secondaryPhone(order.recipientPhone2, order.recipientPhone),
        buyerPhone2: secondaryPhone(order.buyerPhone2, order.buyerPhone),
        // ─ DB 컬럼 미존재 — 사용자가 fixedValue 로 채우거나 비워둠 ─
        supplyPrice: '',
        // 수집일자 — yyyy-mm-dd 포맷
        collectedAt: collectedDate ? formatKstDate(collectedDate) : '',
        collectedAtDateTime: collectedDate ? formatDateTimeMinute(collectedDate) : '',
        collectedDateYmd: collectedDate ? formatKstDate(collectedDate).replaceAll('-', '') : '',
        shippedAt: shippedDate ? formatKstDate(shippedDate) : '',
        // ─ 매출확인용 열 ─
        salesStatus: getSalesStatusLabel(order.status),
        collectedQuantity: rawFirst?.quantity ?? '',
        salesShippingFee: salesValue(order.shippingFee ?? ''),
        salesUnitPrice: salesValue(rawFirst?.unitPrice ?? '0'),
        salesTotalAmount: salesValue(order.totalAmount),
        salesDiscountAndFee: salesValue(salesDiscountAndFee),
        salesPaymentAmount: salesValue(order.totalAmount),
        salesFinalPaymentAmount: salesValue(order.totalAmount),
        salesPaymentFee: '',
        salesProfit: '',
        // 기타1~10 — fixedValue 로 채우는 용도
        etc1: '',
        etc2: '',
        etc3: '',
        etc4: '',
        etc5: '',
        etc6: '',
        etc7: '',
        etc8: '',
        etc9: '',
        etc10: '',
      }
      })
    })

    let buffer: Buffer
    let filename: string

    if (type === 'order-list') {
      // Export with selected columns or all columns
      const selectedFields = columnsParam
        ? columnsParam.split(',').map((field) => {
            const def = AVAILABLE_ORDER_FIELDS.find((f) => f.field === field)
            return def ?? { field, label: field }
          })
        : AVAILABLE_ORDER_FIELDS

      buffer = await exportOrdersToExcel(exportData, selectedFields)
      filename = `orders_${new Date().toISOString().slice(0, 10)}.xlsx`
    } else {
      // Carrier template export
      let template
      if (templateId) {
        template = await getCarrierTemplateById(templateId)
      } else {
        // Use first default template for this user
        const templates = await getCarrierTemplates(workspaceUserId)
        template = templates[0] ?? null
      }

      if (!template) {
        return NextResponse.json(
          { error: 'No carrier template found. Please create a template first.' },
          { status: 404 },
        )
      }

      buffer = await exportToCarrierExcel(exportData, template)
      filename = `${template.name}_${new Date().toISOString().slice(0, 10)}.xlsx`
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    })
  } catch (error) {
    console.error('Excel export error:', error)
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Failed to generate Excel file: ${message}` },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  return handleExportRequest(request)
}

export async function POST(request: NextRequest) {
  let body: ExportRequestBody = {}
  try {
    body = await request.json() as ExportRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  return handleExportRequest(request, body)
}
