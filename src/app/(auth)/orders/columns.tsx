'use client'

import type { ColumnDef, Table } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Copy, ExternalLink, MessageSquare, RotateCcw } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS, type OrderStatus, type ClaimType, type ClaimStatus } from '@/lib/orders/types'
import { ClaimStatusActions } from './claim-status-actions'
import { useState, useTransition } from 'react'
import { copyOrderAction } from './actions'

/** Helper to get openDetail from table.options.meta safely */
function getOpenDetail(table: Table<OrderRow>): ((id: string) => void) | undefined {
  const meta = table.options.meta as { openDetail?: (id: string) => void } | undefined
  return meta?.openDetail
}

function getRefresh(table: Table<OrderRow>): (() => void) | undefined {
  const meta = table.options.meta as { refresh?: () => void } | undefined
  return meta?.refresh
}

/** Copy-order button (shown under internal order id) — duplicates order + items with new internal UUID */
function CopyOrderButton({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm('이 주문을 복사하시겠습니까?\n(주문내용·수취인·주문자 동일, 내부 주문번호만 새로 발급)')) return
        startTransition(async () => {
          const result = await copyOrderAction(orderId)
          if (!result.success) {
            alert(`복사 실패: ${result.error ?? '알 수 없는 오류'}`)
          }
        })
      }}
      title="주문 복사"
      aria-label="주문 복사"
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <Copy className="h-2.5 w-2.5" />
    </button>
  )
}

const CLAIM_REASON_OPTIONS = [
  { value: 'change_of_mind', label: '변심' },
  { value: 'wrong_delivery', label: '오배송' },
  { value: 'defective', label: '불량' },
  { value: 'other', label: '기타사유' },
] as const

type ClaimReasonCode = (typeof CLAIM_REASON_OPTIONS)[number]['value']

function ClaimCreateButton({ order, table }: { order: OrderRow; table: Table<OrderRow> }) {
  const [open, setOpen] = useState(false)
  const [modalType, setModalType] = useState<'return' | 'exchange' | null>(null)
  const [reasonCode, setReasonCode] = useState<ClaimReasonCode>('change_of_mind')
  const [reasonDetail, setReasonDetail] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [pending, startTransition] = useTransition()
  const refresh = getRefresh(table)

  function openClaimModal(claimType: 'return' | 'exchange') {
    setModalType(claimType)
    setReasonCode('change_of_mind')
    setReasonDetail('')
    setQuantities(Object.fromEntries(order.items.map((item) => [item.id, item.quantity])))
    setOpen(false)
  }

  function createClaim() {
    if (!modalType) return
    const claimType = modalType
    const label = claimType === 'return' ? '반품' : '교환'
    const claimItems = order.items.map((item) => ({
      orderItemId: item.id,
      quantity: Number(quantities[item.id] ?? 0),
    })).filter((item) => item.quantity > 0)
    if (claimItems.length === 0) {
      window.alert('접수 수량을 1개 이상 입력해주세요.')
      return
    }

    startTransition(async () => {
      const res = await fetch('/api/orders/claims', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          claimType,
          reasonCode,
          reasonDetail,
          quantities: claimItems,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        window.alert(data.error ?? `${label} 접수 실패`)
        return
      }
      setModalType(null)
      refresh?.()
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        className="inline-flex h-6 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
        title={pending ? '접수중' : '클레임 접수'}
        aria-label={pending ? '접수중' : '클레임 접수'}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[92px] rounded-md border bg-white py-1 shadow-lg">
          <button type="button" onClick={() => openClaimModal('return')} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted">
            반품 접수
          </button>
          <button type="button" onClick={() => openClaimModal('exchange')} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted">
            교환 접수
          </button>
        </div>
      )}
      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-3">
              <h3 className="text-base font-semibold">{modalType === 'return' ? '반품 접수' : '교환 접수'}</h3>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {CLAIM_REASON_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setReasonCode(option.value)}
                  className={`rounded border px-3 py-2 text-sm ${reasonCode === option.value ? 'border-blue-500 bg-blue-50 text-blue-700' : ''}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <textarea
              value={reasonDetail}
              onChange={(event) => setReasonDetail(event.target.value)}
              placeholder="상세 사유"
              className="mb-3 h-20 w-full resize-none rounded border px-3 py-2 text-sm"
            />
            <div className="max-h-64 overflow-auto rounded border">
              {order.items.map((item) => (
                <div key={item.id} className="grid grid-cols-[1fr_88px] items-center gap-2 border-b p-2 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium" title={item.displayName ?? item.productName}>
                      {item.displayName ?? item.productName}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      주문수량 {item.quantity}개
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={item.quantity}
                    value={quantities[item.id] ?? 0}
                    onChange={(event) => {
                      const next = Math.min(item.quantity, Math.max(0, Number(event.target.value)))
                      setQuantities((prev) => ({ ...prev, [item.id]: next }))
                    }}
                    className="h-8 rounded border px-2 text-right text-sm"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setModalType(null)} className="rounded border px-3 py-1.5 text-sm">
                취소
              </button>
              <button
                type="button"
                onClick={createClaim}
                disabled={pending}
                className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {pending ? '접수중' : '접수'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Mapping status cell — Phase A 매핑 시스템 재설계 중에는 비-클릭 표시만.
 * 신규 매핑관리 페이지(/products/mapping) 도입 후 다시 inline 매핑 다이얼로그 연결 예정. */
function MappingCell({ order }: { order: OrderRow }) {
  const status = order.mappingStatus ?? 'unmapped'
  return (
    <span className="cursor-default">
      {status === 'mapped' ? (
        <Badge variant="secondary">매핑됨</Badge>
      ) : status === 'partial' ? (
        <Badge variant="outline" className="border-orange-300 text-orange-700">일부 매핑</Badge>
      ) : (
        <Badge variant="destructive">미매핑</Badge>
      )}
    </span>
  )
}

/** Invoice upload status labels */
const INVOICE_STATUS_LABELS: Record<InvoiceUploadStatus, string> = {
  pending: '대기',
  uploading: '업로드중',
  uploaded: '완료',
  failed: '실패',
  confirmed: '확인됨',
}

const INVOICE_STATUS_VARIANT: Record<InvoiceUploadStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  uploading: 'default',
  uploaded: 'secondary',
  failed: 'destructive',
  confirmed: 'secondary',
}

type InvoiceUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'confirmed'

/** Row shape for the order table (matches getOrders return — Phase 8) */
export interface OrderRow {
  id: string
  /** 사용자에게 보이는 8자리 내부 주문번호 (orders.internal_no) */
  internalNo: string
  marketplaceId: string
  marketplaceName?: string | null
  marketplaceOrderId: string
  buyerName: string
  buyerPhone?: string | null
  buyerPhone2?: string | null
  recipientName?: string | null
  recipientPhone?: string | null
  recipientPhone2?: string | null
  status: OrderStatus
  orderedAt: Date | string
  collectedAt?: Date | string | null
  totalAmount: string
  isHeld: boolean
  holdReason?: string | null
  logisticsMessage?: string | null
  /** Phase 8 — 마켓 수집 배송구분 (prepaid|cod|free|unknown|null) */
  shippingType?: string | null
  /** Phase 8 — 마켓 수집 배송비 (KRW numeric → string from postgres-js) */
  shippingFee?: string | null
  /** Phase 8 — 이 주문에 마켓 문의가 1건 이상 존재하는가 */
  hasInquiries?: boolean
  claimType?: ClaimType | null
  claimId?: string | null
  claimStatus?: ClaimStatus | null
  claimReason?: string | null
  historicalClaimStatuses?: string[]
  invoiceStatus?: InvoiceUploadStatus | null
  trackingNumber?: string | null
  carrierName?: string | null
  mappingStatus?: 'mapped' | 'partial' | 'unmapped'
  shipmentGroupId?: string | null
  shipmentGroupKey?: string | null
  /** 복사된 주문 여부 — true 이면 주문번호 아래 'copy' 배지 표시 */
  isCopy?: boolean
  items: {
    id: string
    marketplaceItemId?: string | null
    productName: string
    /** Phase 8 — product_name_mappings.display_name (null → fallback to productName) */
    displayName?: string | null
    /** 확정 내부 옵션명. 매핑 완료 건은 수집 옵션명 대신 이 값을 표시한다. */
    displayOptionName?: string | null
    optionText: string | null
    quantity: number
    sku?: string | null
    /** Phase 8 — products.shipping_cost (SaaS 등록 원가) */
    shippingCost?: string | null
    /** 잔여 재고 — inventory.available_stock (SKU 매칭 안되면 null) */
    availableStock?: number | null
  }[]
}

/**
 * 상품 셀 — 신규 탭(status=new)에서만 수집상품명을 보조로 같이 표시.
 * 그 외 탭은 확정상품명만 표시(매핑 없으면 fallback으로 productName 자체 노출).
 */
function ProductNameCell({ order }: { order: OrderRow }) {
  const searchParams = useSearchParams()
  const isNewTab = searchParams.get('status') === 'new'

  const items = order.items
  if (!items || items.length === 0)
    return <span className="text-muted-foreground">-</span>

  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-[11px] leading-tight">
      {items.map((item, index) => {
        const primaryName = item.displayName ?? item.productName
        const showOriginal =
          isNewTab && item.displayName != null && item.displayName !== item.productName
        const collected = showOriginal ? ` (${item.productName})` : ''
        const line = `${primaryName}${collected}`
        return (
          <div
            key={item.id}
            className={`min-w-0 ${index > 0 ? 'border-t border-slate-100 pt-0.5' : ''}`}
          >
            <span className="block truncate font-mono text-[10px] text-muted-foreground" title={item.sku ?? ''}>
              {item.sku ?? '-'}
            </span>
            <span
              className="block min-w-0 overflow-hidden font-medium leading-tight [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
              title={line}
            >
              {line}
            </span>
          </div>
        )
      })}
      {order.logisticsMessage && (
        <span
          className="mt-0.5 inline-flex max-w-full items-center truncate rounded border border-blue-300 bg-blue-50 px-1 py-0.5 text-[10px] font-medium text-blue-700"
          title={order.logisticsMessage}
        >
          {order.logisticsMessage}
        </span>
      )}
    </div>
  )
}

function OptionInfoCell({ order }: { order: OrderRow }) {
  const items = order.items
  if (!items || items.length === 0) {
    return <span className="text-muted-foreground">-</span>
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-[11px] leading-tight">
      {items.map((item, index) => {
        const rawOption = item.displayOptionName ?? item.optionText
        const option = rawOption
          ?.replace(/^\s*(선택|옵션)\s*[:：]?\s*/i, '')
          .trim()
        return (
          <div
            key={item.id}
            className={`min-w-0 ${index > 0 ? 'border-t border-slate-100 pt-0.5' : ''}`}
          >
            {option ? (
              <span className="block truncate" title={option}>
                {option}
              </span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

const STATUS_PILL_STYLES: Record<OrderStatus, string> = {
  new: 'border-sky-200 bg-sky-50 text-sky-700',
  confirmed: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  preparing: 'border-amber-200 bg-amber-50 text-amber-800',
  ready: 'border-violet-200 bg-violet-50 text-violet-700',
  shipped: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  delivering: 'border-blue-200 bg-blue-50 text-blue-700',
  delivered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-rose-200 bg-rose-100 text-rose-800',
}

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  requested: '접수',
  processing: '처리중',
  completed: '완료',
  rejected: '거절',
}

const CLAIM_PILL_STYLES: Record<ClaimType, string> = {
  cancel: 'border-rose-200 bg-rose-100 text-rose-800',
  exchange: 'border-blue-200 bg-blue-50 text-blue-700',
  return: 'border-orange-200 bg-orange-50 text-orange-800',
}

const MARKETPLACE_LABELS: Record<string, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  gmarket: 'G마켓',
  auction: '옥션',
  elevenst: '11번가',
  '11st': '11번가',
  cafe24: 'Cafe24',
  domeggook: '도매꾹',
  tobizon: '투비즈온',
  domesin: '도매의신',
  'banana-b2b': '바나나B2B',
  ohouse: '오늘의집',
  ssgmall: 'SSG',
  cjonestyle: 'CJ온스타일',
  ably: '에이블리',
  'hyundai-hmall': '현대홈쇼핑',
  'gs-shop': 'GS샵',
  esm: 'ESM',
  always: '올웨이즈',
  zigzag: '지그재그',
  'toss-shopping': '토스쇼핑',
  ownerclan: '오너클랜',
  onchannel: '온채널',
  '10x10': '텐바이텐',
}

function getMarketplaceLabel(id: string): string {
  return MARKETPLACE_LABELS[id] ?? id
}

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  return phone
}

/** 합포장 그룹 ID → 배경/텍스트 색 조합 (해시 기반 결정적 매핑) */
const GROUP_COLORS = [
  'border-pink-400 bg-pink-50 text-pink-700',
  'border-amber-400 bg-amber-50 text-amber-700',
  'border-emerald-400 bg-emerald-50 text-emerald-700',
  'border-sky-400 bg-sky-50 text-sky-700',
  'border-violet-400 bg-violet-50 text-violet-700',
  'border-rose-400 bg-rose-50 text-rose-700',
  'border-cyan-400 bg-cyan-50 text-cyan-700',
  'border-lime-400 bg-lime-50 text-lime-700',
  'border-orange-400 bg-orange-50 text-orange-700',
  'border-teal-400 bg-teal-50 text-teal-700',
]
function groupColor(groupId: string): string {
  let hash = 0
  for (let i = 0; i < groupId.length; i++) {
    hash = (hash * 31 + groupId.charCodeAt(i)) | 0
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length]
}

/** Phase 8 — 배송구분 한글 라벨 */
const SHIPPING_TYPE_LABELS: Record<string, string> = {
  prepaid: '선결제',
  cod: '착불',
  free: '무료',
}
function shippingTypeLabel(t: string | null | undefined): string {
  if (!t) return '—'
  return SHIPPING_TYPE_LABELS[t] ?? t
}

/** Phase 8 — Claim type 한글 라벨 */
const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  cancel: '취소',
  exchange: '교환',
  return: '반품',
}

function claimSummaryLabel(order: OrderRow): string | null {
  if (order.claimReason && /^(취소|반품|교환)/.test(order.claimReason)) {
    return order.claimReason
  }
  if (!order.claimType || !order.claimStatus) return null
  return `${CLAIM_TYPE_LABELS[order.claimType]}${CLAIM_STATUS_LABELS[order.claimStatus]}`
}

function ClaimActionDropdown({
  claimId,
  claimType,
  claimStatus,
  reason,
}: {
  claimId: string
  claimType: ClaimType
  claimStatus: ClaimStatus
  reason: string | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-6 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50"
        title="클레임 처리"
        aria-label="클레임 처리"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-md border bg-white p-2 shadow-lg">
          <ClaimStatusActions
            claimId={claimId}
            claimType={claimType}
            claimStatus={claimStatus}
            reason={reason}
          />
        </div>
      )}
    </div>
  )
}

export const columns: ColumnDef<OrderRow>[] = [
  // Checkbox
  {
    id: 'select',
    header: ({ table }) => (
      <input
        type="checkbox"
        checked={table.getIsAllPageRowsSelected()}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        aria-label="전체 선택"
        className="h-4 w-4 rounded border-gray-300"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        aria-label="행 선택"
        className="h-4 w-4 rounded border-gray-300"
      />
    ),
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    size: 32,
    minSize: 32,
    maxSize: 32,
  },

  // 주문상태 + 인디케이터 통합 (claim 뱃지 / 문의 / 미발송 holdReason) — Phase 8 SC-03
  {
    id: 'statusActions',
    header: '주문상태',
    cell: ({ row, table }) => {
      const order = row.original
      const openDetail = getOpenDetail(table)
      const claimLabel = claimSummaryLabel(order)
      const primaryLabel = claimLabel ?? ORDER_STATUS_LABELS[order.status]
      const primaryStyle = order.claimType
        ? CLAIM_PILL_STYLES[order.claimType]
        : STATUS_PILL_STYLES[order.status]
      const historicalClaimStatuses = (order.historicalClaimStatuses ?? [])
        .filter((status) => status !== primaryLabel)
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1">
            <span
              className={`inline-flex h-6 min-w-0 max-w-full items-center justify-center truncate rounded border px-1.5 text-[11px] font-semibold ${primaryStyle}`}
              title={order.claimReason ?? ORDER_STATUS_LABELS[order.status]}
            >
              {primaryLabel}
            </span>
            {historicalClaimStatuses.slice(0, 1).map((status) => (
              <span
                key={status}
                className="inline-flex h-6 max-w-[68px] shrink-0 items-center truncate rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-600"
                title={status}
              >
                {status}
              </span>
            ))}
            {order.hasInquiries && (
              <span className="inline-flex h-6 shrink-0 items-center rounded border border-blue-200 bg-blue-50 px-1 text-[10px] font-medium text-blue-700" title="문의">
                문의
              </span>
            )}
            {order.isHeld && (
              <span
                title={order.holdReason ?? '미발송'}
                className="inline-flex h-6 shrink-0 items-center rounded border border-purple-200 bg-purple-50 px-1 text-[10px] font-medium text-purple-700"
              >
                미발
              </span>
            )}
            {order.isHeld && order.holdReason && (
              <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={order.holdReason}>
                {order.holdReason}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {order.claimId && order.claimType && order.claimStatus ? (
              <ClaimActionDropdown
                claimId={order.claimId}
                claimType={order.claimType}
                claimStatus={order.claimStatus}
                reason={order.claimReason ?? null}
              />
            ) : (
              <ClaimCreateButton order={order} table={table} />
            )}
            <button
              type="button"
              onClick={() => openDetail?.(order.id)}
              className="inline-flex h-6 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50"
              title="주문 상세 / C/S"
              aria-label="주문 상세 / C/S"
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          {historicalClaimStatuses.length > 1 && (
            <div className="hidden">
              {historicalClaimStatuses.slice(1).map((status) => (
                <span
                  key={status}
                  title={status}
                >
                  {status}
                </span>
              ))}
            </div>
          )}
        </div>
      )
    },
    enableSorting: false,
    size: 150,
    minSize: 112,
    maxSize: 340,
  },

  // 쇼핑몰
  {
    accessorKey: 'marketplaceId',
    header: '쇼핑몰',
    cell: ({ row }) => {
      const order = row.original
      return (
        <Badge
          variant="outline"
          className="max-w-full whitespace-normal break-keep leading-tight"
          title={order.marketplaceName ?? getMarketplaceLabel(order.marketplaceId)}
        >
          {order.marketplaceName ?? getMarketplaceLabel(order.marketplaceId)}
        </Badge>
      )
    },
    size: 124,
    minSize: 104,
    maxSize: 220,
  },

  // 수집/주문일시
  {
    id: 'orderedAt',
    header: '주문일시',
    cell: ({ row }) => {
      const ordered = row.original.orderedAt
      const collected = row.original.collectedAt
      return (
        <div className="min-w-0 text-xs leading-tight">
          <span className="block truncate" title={format(new Date(ordered), 'yyyy-MM-dd HH:mm')}>
            {format(new Date(ordered), 'MM-dd HH:mm')}
          </span>
          {collected && (
            <span className="block truncate text-[10px] text-muted-foreground" title={`수집 ${format(new Date(collected), 'yyyy-MM-dd HH:mm')}`}>
              수집 {format(new Date(collected), 'MM-dd HH:mm')}
            </span>
          )}
        </div>
      )
    },
    size: 100,
    minSize: 92,
    maxSize: 180,
  },

  // 주문번호 (마켓 + 내부)
  {
    id: 'orderNumber',
    header: '주문번호',
    cell: ({ row, table }) => {
      const order = row.original
      const openDetail = getOpenDetail(table)
      return (
        <div className="flex min-w-0 flex-col gap-0 text-xs leading-tight">
          <button
            type="button"
            onClick={() => openDetail?.(order.id)}
            className="break-all text-left font-mono font-semibold text-primary hover:underline"
            title={order.marketplaceOrderId}
          >
            {order.marketplaceOrderId}
          </button>
          <div className="flex min-w-0 items-center gap-1">
            <span
              className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
              title="내부 주문번호"
            >
              #{order.internalNo}
            </span>
            <CopyOrderButton orderId={order.id} />
            {order.isCopy && (
              <span
                title="복사된 주문"
                className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 py-px text-[9px] font-medium text-amber-700 ring-1 ring-amber-200"
              >
                <Copy className="h-2.5 w-2.5" />
                copy
              </span>
            )}
          </div>
        </div>
      )
    },
    size: 176,
    minSize: 156,
    maxSize: 260,
  },

  // 상품 (SKU + 확정상품명 + 옵션 + 물류메세지) — Phase 8 SC-04
  // 신규 탭에서만 원본(수집상품명) 보조 표시, 그 외 탭은 확정상품명만 표시
  {
    id: 'productInfo',
    header: '상품명',
    cell: ({ row }) => <ProductNameCell order={row.original} />,
    size: 320,
    minSize: 240,
    maxSize: 620,
  },

  {
    id: 'optionInfo',
    header: '옵션명',
    cell: ({ row }) => <OptionInfoCell order={row.original} />,
    size: 220,
    minSize: 150,
    maxSize: 420,
  },

  // 수량 — 메인: 주문 수량, 보조(괄호): 잔여 재고 (SKU 매칭 안되면 - 표시)
  {
    id: 'quantity',
    header: '수량',
    cell: ({ row }) => {
      const items = row.original.items
      if (!items || items.length === 0)
        return <span className="text-muted-foreground">-</span>
      return (
        <div className="flex min-w-0 flex-col items-end gap-0.5 leading-tight tabular-nums">
          {items.map((item, index) => {
            const stock = item.availableStock
            const lowStock = stock != null && stock < item.quantity
            return (
              <div
                key={item.id}
                className={`w-full truncate text-right ${index > 0 ? 'border-t border-slate-100 pt-0.5' : ''}`}
              >
                <span className="text-sm font-semibold">{item.quantity}</span>
                <span
                  className={`ml-1 text-[10px] ${
                    lowStock ? 'font-medium text-red-600' : 'text-muted-foreground'
                  }`}
                  title={stock == null ? 'SKU 매핑 없음' : '잔여 재고'}
                >
                  ({stock ?? '-'})
                </span>
              </div>
            )
          })}
        </div>
      )
    },
    size: 48,
    minSize: 46,
    maxSize: 100,
  },

  // 구매자
  {
    id: 'buyerInfo',
    header: '구매자',
    cell: ({ row }) => {
      const order = row.original
      const phone = order.buyerPhone2 || order.buyerPhone || ''
      return (
        <div className="flex min-w-0 flex-col gap-0 text-xs leading-tight">
          <span className="min-w-0 truncate font-medium" title={order.buyerName}>
            {order.buyerName}
          </span>
          {phone && (
            <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground" title={phone}>
              {formatPhone(phone)}
            </span>
          )}
          {order.shipmentGroupId && (
            <span
              className={`mt-0.5 inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${groupColor(order.shipmentGroupId)}`}
              title={order.shipmentGroupKey ?? ''}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: 'currentColor' }}
              />
              합포장 · {order.shipmentGroupId.slice(0, 4).toUpperCase()}
            </span>
          )}
        </div>
      )
    },
    size: 108,
    minSize: 96,
    maxSize: 220,
  },

  // 수취인
  {
    id: 'recipientInfo',
    header: '수취인',
    cell: ({ row }) => {
      const order = row.original
      const phone = order.recipientPhone2 || order.recipientPhone || ''
      return (
        <div className="flex min-w-0 flex-col gap-0 text-xs leading-tight">
          <span className="min-w-0 truncate font-medium" title={order.recipientName ?? '-'}>
            {order.recipientName ?? '-'}
          </span>
          {phone && (
            <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground" title={phone}>
              {formatPhone(phone)}
            </span>
          )}
        </div>
      )
    },
    size: 108,
    minSize: 96,
    maxSize: 240,
  },

  // 금액
  {
    accessorKey: 'totalAmount',
    header: '금액',
    cell: ({ row }) => {
      const num = Number(row.getValue('totalAmount') as string)
      if (Number.isNaN(num)) return '-'
      return (
        <span className="font-medium tabular-nums">
          {num.toLocaleString('ko-KR')}
          <span className="ml-0.5 text-[10px] text-muted-foreground">원</span>
        </span>
      )
    },
    size: 68,
    minSize: 64,
    maxSize: 130,
  },

  // 매핑 — 매핑 필요 스테이지에서만 노출 (data-table이 columnVisibility로 제어)
  {
    id: 'mappingStatus',
    header: '매핑',
    cell: ({ row }) => <MappingCell order={row.original} />,
    size: 72,
    minSize: 70,
    maxSize: 130,
  },

  // Phase 8 — 배송구분
  {
    id: 'shippingType',
    header: '배송구분',
    cell: ({ row }) => {
      const t = row.original.shippingType
      return (
        <Badge variant="outline" className="text-[11px]">
          {shippingTypeLabel(t)}
        </Badge>
      )
    },
    size: 60,
    minSize: 58,
    maxSize: 120,
  },

  // Phase 8 — 배송비 (수집 / 등록 통합)
  //   상단: 수집 배송비 (마켓 원본)
  //   하단: SaaS 등록 배송비(원가) — products.shipping_cost SUM
  {
    id: 'shippingFees',
    header: '배송비',
    cell: ({ row }) => {
      const fee = row.original.shippingFee
      const items = row.original.items ?? []
      const haveCost = items.some((i) => i.shippingCost != null && i.shippingCost !== '')
      const costSum = haveCost
        ? items.reduce((acc, i) => acc + Number(i.shippingCost ?? 0), 0)
        : null

      const feeNum = fee == null || fee === '' ? null : Number(fee)
      const feeText =
        feeNum != null && !Number.isNaN(feeNum) ? `${feeNum.toLocaleString('ko-KR')}원` : '—'
      const costText =
        costSum != null && !Number.isNaN(costSum)
          ? `${costSum.toLocaleString('ko-KR')}원`
          : '—'

      return (
        <div className="flex min-w-0 flex-col gap-0 text-[11px] leading-tight tabular-nums">
          <span>{feeText}</span>
          <span className="truncate text-[10px] text-muted-foreground">{costText}</span>
        </div>
      )
    },
    size: 72,
    minSize: 68,
    maxSize: 110,
  },

  // 택배사 · 송장
  {
    id: 'shipping',
    header: '송장',
    cell: ({ row }) => {
      const order = row.original
      const invoiceStatus = order.invoiceStatus
      const trackingNumber = order.trackingNumber
      if (!invoiceStatus && !trackingNumber) {
        return <span className="text-[11px] text-muted-foreground">미등록</span>
      }
      return (
        <div className="flex min-w-0 flex-col gap-0 text-[11px] leading-tight">
          {order.carrierName && (
            <span className="truncate text-[11px] font-medium" title={order.carrierName}>{order.carrierName}</span>
          )}
          {trackingNumber && (
            <span className="truncate font-mono text-[11px] text-muted-foreground" title={trackingNumber}>
              {trackingNumber}
            </span>
          )}
          {invoiceStatus && (
            <Badge variant={INVOICE_STATUS_VARIANT[invoiceStatus]} className="w-fit text-[10px]">
              {INVOICE_STATUS_LABELS[invoiceStatus]}
            </Badge>
          )}
        </div>
      )
    },
    size: 98,
    minSize: 90,
    maxSize: 180,
  },
]
