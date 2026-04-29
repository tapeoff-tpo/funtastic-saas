'use client'

import type { ColumnDef, Table } from '@tanstack/react-table'
import { format } from 'date-fns'
import { MessageCircle, Lock, Copy } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS, type OrderStatus, type ClaimType, type ClaimStatus } from '@/lib/orders/types'
import { ClaimStatusActions } from './claim-status-actions'
import { InlineMappingDialog } from './inline-mapping-dialog'
import { useState, useTransition } from 'react'
import { copyOrderAction } from './actions'

/** Helper to get openDetail from table.options.meta safely */
function getOpenDetail(table: Table<OrderRow>): ((id: string) => void) | undefined {
  const meta = table.options.meta as { openDetail?: (id: string) => void } | undefined
  return meta?.openDetail
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
      className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <Copy className="h-2.5 w-2.5" />
    </button>
  )
}

/** Mapping status cell — clickable badge that opens inline mapping dialog */
function MappingCell({ order }: { order: OrderRow }) {
  const [open, setOpen] = useState(false)
  const status = order.mappingStatus ?? 'unmapped'

  return (
    <>
      <button
        type="button"
        onClick={() => status !== 'mapped' && setOpen(true)}
        disabled={status === 'mapped'}
        className={status !== 'mapped' ? 'cursor-pointer' : 'cursor-default'}
      >
        {status === 'mapped' ? (
          <Badge variant="secondary">매핑됨</Badge>
        ) : status === 'partial' ? (
          <Badge variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50">일부 매핑</Badge>
        ) : (
          <Badge variant="destructive" className="hover:opacity-80">미매핑</Badge>
        )}
      </button>
      <InlineMappingDialog
        open={open}
        marketplaceId={order.marketplaceId}
        items={order.items.map((i) => ({
          productName: i.productName,
          optionText: i.optionText,
          quantity: i.quantity,
        }))}
        onClose={() => setOpen(false)}
        onSaved={() => { window.location.reload() }}
      />
    </>
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
  invoiceStatus?: InvoiceUploadStatus | null
  trackingNumber?: string | null
  carrierName?: string | null
  mappingStatus?: 'mapped' | 'partial' | 'unmapped'
  shipmentGroupId?: string | null
  shipmentGroupKey?: string | null
  items: {
    productName: string
    /** Phase 8 — product_name_mappings.display_name (null → fallback to productName) */
    displayName?: string | null
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
function ProductInfoCell({ order }: { order: OrderRow }) {
  const searchParams = useSearchParams()
  const isNewTab = searchParams.get('status') === 'new'

  const items = order.items
  if (!items || items.length === 0)
    return <span className="text-muted-foreground">-</span>
  const first = items[0]
  const extra = items.length - 1
  const primaryName = first.displayName ?? first.productName
  const showOriginal =
    isNewTab && first.displayName != null && first.displayName !== first.productName

  return (
    <div className="flex flex-col gap-0 text-xs leading-tight">
      {first.sku && (
        <span className="font-mono text-[10px] text-muted-foreground">
          {first.sku}
        </span>
      )}
      <span className="max-w-[280px] truncate font-medium" title={primaryName}>
        {primaryName}
      </span>
      {showOriginal && (
        <span
          className="max-w-[280px] truncate text-[10px] text-muted-foreground"
          title={`수집상품명: ${first.productName}`}
        >
          ({first.productName})
        </span>
      )}
      {first.optionText && (
        <span
          className="max-w-[280px] truncate text-[11px] text-muted-foreground"
          title={first.optionText}
        >
          {first.optionText}
        </span>
      )}
      {extra > 0 && (
        <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-[10px]">
          +{extra}건
        </span>
      )}
      {order.logisticsMessage && (
        <span
          className="mt-1 inline-flex w-fit items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
          title={order.logisticsMessage}
        >
          📦 {order.logisticsMessage}
        </span>
      )}
    </div>
  )
}

const STATUS_VARIANT: Record<OrderStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  new: 'default',
  confirmed: 'secondary',
  preparing: 'outline',
  ready: 'default',
  shipped: 'secondary',
  delivering: 'default',
  delivered: 'secondary',
  cancelled: 'destructive',
}

const MARKETPLACE_LABELS: Record<string, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  gmarket: 'G마켓',
  auction: '옥션',
  '11st': '11번가',
  cafe24: 'Cafe24',
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

/** Phase 8 — Claim type 한글 라벨 + 배지 색 */
const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  cancel: '취소',
  exchange: '교환',
  return: '반품',
}
const CLAIM_TYPE_BADGE: Record<ClaimType, string> = {
  cancel: 'border-red-300 bg-red-50 text-red-700',
  exchange: 'border-blue-300 bg-blue-50 text-blue-700',
  return: 'border-orange-300 bg-orange-50 text-orange-700',
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
    size: 32,
  },

  // 주문상태 + 인디케이터 통합 (claim 뱃지 / 문의 / 미발송 holdReason) — Phase 8 SC-03
  {
    id: 'statusActions',
    header: '주문상태',
    cell: ({ row, table }) => {
      const order = row.original
      const openDetail = getOpenDetail(table)
      return (
        <div className="flex flex-col gap-1">
          {/* 인디케이터 클러스터 — claim badge / 문의 / 미발송 */}
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant={STATUS_VARIANT[order.status]} className="w-fit">
              {ORDER_STATUS_LABELS[order.status]}
            </Badge>
            {order.claimType && (
              <span
                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${CLAIM_TYPE_BADGE[order.claimType]}`}
                title={order.claimReason ?? CLAIM_TYPE_LABELS[order.claimType]}
              >
                {CLAIM_TYPE_LABELS[order.claimType]}
              </span>
            )}
            {order.hasInquiries && (
              <span title="문의 있음" className="inline-flex items-center text-blue-600">
                <MessageCircle className="h-3.5 w-3.5" aria-label="문의" />
              </span>
            )}
            {order.isHeld && (
              <span
                title={order.holdReason ?? '미발송'}
                className="inline-flex items-center gap-0.5 rounded border border-purple-300 bg-purple-50 px-1 py-0.5 text-[10px] font-medium text-purple-700"
              >
                <Lock className="h-3 w-3" aria-label="미발송" />
                미발송
              </span>
            )}
          </div>
          {/* hold reason 보조 텍스트 (Pitfall 3 — holdReason 정보 보존) */}
          {order.isHeld && order.holdReason && (
            <span className="max-w-[180px] truncate text-[10px] text-muted-foreground" title={order.holdReason}>
              {order.holdReason}
            </span>
          )}
          {/* Claim 액션 (기존 ClaimStatusActions) */}
          {order.claimId && order.claimType && order.claimStatus ? (
            <ClaimStatusActions
              claimId={order.claimId}
              claimType={order.claimType}
              claimStatus={order.claimStatus}
              reason={order.claimReason ?? null}
            />
          ) : (
            <button
              type="button"
              onClick={() => openDetail?.(order.id)}
              className="w-fit rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
            >
              Claim
            </button>
          )}
        </div>
      )
    },
    enableSorting: false,
    size: 130,
  },

  // 쇼핑몰
  {
    accessorKey: 'marketplaceId',
    header: '쇼핑몰',
    cell: ({ row }) => (
      <Badge variant="outline">
        {getMarketplaceLabel(row.getValue('marketplaceId') as string)}
      </Badge>
    ),
    size: 90,
  },

  // 수집/주문일시
  {
    id: 'orderedAt',
    header: '주문일시',
    cell: ({ row }) => {
      const ordered = row.original.orderedAt
      const collected = row.original.collectedAt
      return (
        <div className="flex flex-col gap-0 text-xs leading-tight">
          <span>{format(new Date(ordered), 'yyyy-MM-dd HH:mm')}</span>
          {collected && (
            <span className="text-muted-foreground">
              수집 {format(new Date(collected), 'MM-dd HH:mm')}
            </span>
          )}
        </div>
      )
    },
    size: 140,
  },

  // 주문번호 (마켓 + 내부)
  {
    id: 'orderNumber',
    header: '주문번호',
    cell: ({ row, table }) => {
      const order = row.original
      const openDetail = getOpenDetail(table)
      return (
        <div className="flex flex-col gap-0 text-xs leading-tight">
          <button
            type="button"
            onClick={() => openDetail?.(order.id)}
            className="text-left font-mono font-medium text-primary hover:underline"
          >
            {order.marketplaceOrderId}
          </button>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground">
              #{order.id.slice(0, 8)}
            </span>
            <CopyOrderButton orderId={order.id} />
          </div>
        </div>
      )
    },
    size: 180,
  },

  // 상품 (SKU + 확정상품명 + 옵션 + 물류메세지) — Phase 8 SC-04
  // 신규 탭에서만 원본(수집상품명) 보조 표시, 그 외 탭은 확정상품명만 표시
  {
    id: 'productInfo',
    header: '상품',
    cell: ({ row }) => <ProductInfoCell order={row.original} />,
    size: 300,
  },

  // 수량 — 메인: 주문 수량, 보조(괄호): 잔여 재고 (SKU 매칭 안되면 - 표시)
  {
    id: 'quantity',
    header: '수량',
    cell: ({ row }) => {
      const items = row.original.items
      if (!items || items.length === 0)
        return <span className="text-muted-foreground">-</span>
      const first = items[0]
      const stock = first.availableStock
      const lowStock = stock != null && stock < first.quantity
      return (
        <div className="flex flex-col items-end gap-0 leading-tight tabular-nums">
          <span className="text-sm font-semibold">{first.quantity}</span>
          <span
            className={`text-[10px] ${
              lowStock ? 'font-medium text-red-600' : 'text-muted-foreground'
            }`}
            title={stock == null ? 'SKU 매핑 없음' : '잔여 재고'}
          >
            ({stock ?? '-'})
          </span>
        </div>
      )
    },
    size: 60,
  },

  // 구매자 / 수취인
  {
    id: 'contact',
    header: '구매자 · 수취인',
    cell: ({ row }) => {
      const order = row.original
      return (
        <div className="flex flex-col gap-0 text-xs leading-tight">
          <div>
            <span className="inline-block w-7 text-[10px] text-muted-foreground">구매</span>
            <span className="font-medium">{order.buyerName}</span>
            {order.buyerPhone && (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {formatPhone(order.buyerPhone)}
              </span>
            )}
          </div>
          <div>
            <span className="inline-block w-7 text-[10px] text-muted-foreground">수취</span>
            <span className="font-medium">{order.recipientName ?? '-'}</span>
            {order.recipientPhone && (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {formatPhone(order.recipientPhone)}
              </span>
            )}
          </div>
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
    size: 200,
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
    size: 100,
  },

  // 매핑 — 매핑 필요 스테이지에서만 노출 (data-table이 columnVisibility로 제어)
  {
    id: 'mappingStatus',
    header: '매핑',
    cell: ({ row }) => <MappingCell order={row.original} />,
    size: 90,
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
    size: 80,
  },

  // Phase 8 — 배송비 (수집 / 등록 통합)
  //   상단: 수집 배송비 (마켓 원본)
  //   하단: SaaS 등록 배송비(원가) — products.shipping_cost SUM
  {
    id: 'shippingFees',
    header: '배송비 (수집/등록)',
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
        <div className="flex flex-col gap-0.5 text-xs leading-tight tabular-nums">
          <span>{feeText}</span>
          <span className="text-[10px] text-muted-foreground">{costText}</span>
        </div>
      )
    },
    size: 110,
  },

  // 택배사 · 송장
  {
    id: 'shipping',
    header: '택배 · 송장',
    cell: ({ row }) => {
      const order = row.original
      const invoiceStatus = order.invoiceStatus
      const trackingNumber = order.trackingNumber
      if (!invoiceStatus && !trackingNumber) {
        return <span className="text-xs text-muted-foreground">미등록</span>
      }
      return (
        <div className="flex flex-col gap-0.5 text-xs leading-tight">
          {order.carrierName && (
            <span className="text-[11px] font-medium">{order.carrierName}</span>
          )}
          {trackingNumber && (
            <span className="font-mono text-[11px] text-muted-foreground">
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
    size: 140,
  },
]
