/**
 * Order domain types and business rules.
 *
 * Defines the order status workflow, Korean labels,
 * valid transitions, and filter interfaces for queries.
 */

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'shipped'
  | 'delivering'
  | 'delivered'
  | 'cancelled'

export type ClaimType = 'cancel' | 'return' | 'exchange'

export type ClaimStatus = 'requested' | 'processing' | 'completed' | 'rejected'

/** Korean labels for order statuses (per D-07) */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: '신규',
  confirmed: '확인',
  preparing: '출고대기',
  ready: '출고준비',
  shipped: '출고완료',
  delivering: '배송중',
  delivered: '배송완료',
  cancelled: '취소',
}

/**
 * Valid status transitions per D-07.
 * Terminal statuses (delivered, cancelled) have no valid next states.
 */
export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['shipped', 'cancelled'],
  shipped: ['delivering'],
  delivering: ['delivered'],
  delivered: [],
  cancelled: [],
}

/** Check if a status transition is valid */
export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export type MappingStatus = 'mapped' | 'partial' | 'unmapped'

export type OrderSearchField =
  | 'all'
  | 'buyerName'
  | 'recipientName'
  | 'marketplaceOrderId'
  | 'internalNo'
  | 'sku'
  | 'marketplaceProductCode'
  | 'collectedProductName'
  | 'confirmedProductName'
  | 'recipientPhone'
  | 'recipientPhone2'
  | 'buyerPhone'
  | 'buyerPhone2'
  | 'trackingNumber'
  | 'logisticsMessage'

/** 주문 처리 단계 (워크플로우) */
export type OrderStage =
  | 'prep'        // 출고 준비 (매핑 필요 ∪ 확정 대기) — 매핑 먼저, 그 다음 몰 통보
  | 'mapping'     // 매핑 필요 (prep의 하위)
  | 'confirm'     // 확정 대기 (prep의 하위, 신규 + 매핑완료)
  | 'invoice'     // 송장 발급 (주문확인, 송장 없음)
  | 'shipping'    // 출고 대기 (출고대기/준비중, 송장 있음)
  | 'done'        // 완료 (출고/배송중/배송완료)

/** Filter interface for order listing queries */
export interface OrderFilters {
  page?: number
  pageSize?: number
  /** Scope to a specific user — REQUIRED for production queries (security + perf). */
  userId?: string
  status?: OrderStatus
  marketplace?: string
  search?: string
  searchField?: OrderSearchField
  /**
   * Internal query helper: SKU candidates resolved from confirmed product names.
   * Includes exact internal SKUs and base SKU prefixes for imported marketplace rows.
   */
  confirmedProductSearchSkus?: string[]
  dateFrom?: string
  dateTo?: string
  sort?: string
  order?: 'asc' | 'desc'
  claimType?: ClaimType
  mapping?: 'mapped' | 'unmapped' | 'all'
  stage?: OrderStage
  /** Filter to only held (미발송) orders */
  isHeld?: boolean
  /**
   * Phase 8 — 취소 탭 통합 필터.
   * true → orders.status='cancelled' OR claims.claimType='cancel' (distinct)
   */
  cancelTab?: boolean
  /**
   * 신규 매핑 작업 탭용 필터.
   * true → 클레임 레코드가 있거나 마켓 원상태가 취소/반품/교환인 주문 제외.
   */
  excludeClaimLikeOrders?: boolean
}

/**
 * Phase 8 — Dashboard 9탭 + claim 카운트 stats.
 * status counts (7) + claim counts (3) + cancelTabCount (distinct OR).
 */
export interface OrderStats {
  // status counts (orders.status)
  new: number
  confirmed: number
  preparing: number
  ready: number
  shipped: number
  delivering: number
  delivered: number
  cancelled: number
  // claim counts — DISTINCT order_id per claimType
  claimCancel: number
  claimExchange: number
  claimReturn: number
  /**
   * 취소 탭 통합 카운트 — DISTINCT order_id WHERE
   * orders.status='cancelled' OR claims.claimType='cancel'.
   * 단일 SQL로 정확 계산. (B-3)
   */
  cancelTabCount: number
  // legacy/aux fields (backward compat for older callers)
  total?: number
  /** legacy alias for claimCancel — kept for transitional callers; prefer claimCancel */
  cancel?: number
  /** legacy alias for claimReturn — kept for transitional callers */
  return?: number
  /** legacy alias for claimExchange — kept for transitional callers */
  exchange?: number
  /** count of orders.is_held=true */
  held?: number
  /** legacy alias for `new` (avoid TS reserved-word collision in older callers) */
  newCount?: number
}

/**
 * Phase 8 — Order list row returned by getOrders.
 * Wraps the orders schema with computed fields (claim summary, shipment, mapping status,
 * inquiry indicator) and a normalized items[] (with displayName + shippingCost).
 */
export interface OrderListItem {
  id: string
  marketplaceId: string
  marketplaceOrderId: string
  buyerName: string
  buyerPhone?: string | null
  recipientName?: string | null
  recipientPhone?: string | null
  status: OrderStatus
  orderedAt: Date | string
  collectedAt?: Date | string | null
  totalAmount: string
  isHeld: boolean
  holdReason?: string | null
  logisticsMessage?: string | null
  /** Phase 8 — 마켓에서 수집된 배송구분 (prepaid|cod|free|unknown) */
  shippingType: string | null
  /** Phase 8 — 마켓에서 수집된 배송비 (KRW, numeric => string) */
  shippingFee: string | null
  claimType?: ClaimType | null
  claimId?: string | null
  claimStatus?: ClaimStatus | null
  claimReason?: string | null
  invoiceStatus?: string | null
  trackingNumber?: string | null
  carrierName?: string | null
  mappingStatus?: MappingStatus
  shipmentGroupId?: string | null
  shipmentGroupKey?: string | null
  /** Phase 8 — 이 주문에 마켓 문의가 1건 이상 존재하는가 */
  hasInquiries: boolean
  items: Array<{
    id: string
    marketplaceItemId: string | null
    productName: string
    /** Phase 8 — product_name_mappings.display_name (매핑 없을 때 null → fallback to productName) */
    displayName: string | null
    optionText: string | null
    quantity: number
    sku: string | null
    /** Phase 8 — products.shipping_cost (SaaS 등록 원가, NULL 가능) */
    shippingCost: string | null
  }>
}
