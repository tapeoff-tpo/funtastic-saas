'use client'

import type { ColumnDef, Table } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS, type OrderStatus, type ClaimType, type ClaimStatus } from '@/lib/orders/types'
import { ClaimStatusActions } from './claim-status-actions'
import { InlineMappingDialog } from './inline-mapping-dialog'
import { useState } from 'react'

/** Helper to get openDetail from table.options.meta safely */
function getOpenDetail(table: Table<OrderRow>): ((id: string) => void) | undefined {
  const meta = table.options.meta as { openDetail?: (id: string) => void } | undefined
  return meta?.openDetail
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

/** Row shape for the order table (matches getOrders return) */
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
    optionText: string | null
    quantity: number
    sku?: string | null
  }[]
}

const STATUS_VARIANT: Record<OrderStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  new: 'default',
  confirmed: 'secondary',
  preparing: 'outline',
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
  // Normalize: 010-1234-5678 format
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

  // 주문상태 | Claim 버튼 (팝업으로 전체 주문정보 + CS 메모)
  {
    id: 'statusActions',
    header: '주문상태',
    cell: ({ row, table }) => {
      const order = row.original
      const openDetail = getOpenDetail(table)
      return (
        <div className="flex flex-col gap-1">
          <Badge variant={STATUS_VARIANT[order.status]} className="w-fit">
            {ORDER_STATUS_LABELS[order.status]}
          </Badge>
          <button
            type="button"
            onClick={() => openDetail?.(order.id)}
            className="w-fit rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
          >
            Claim
          </button>
        </div>
      )
    },
    enableSorting: false,
    size: 110,
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
          <span className="font-mono text-[10px] text-muted-foreground">
            #{order.id.slice(0, 8)}
          </span>
        </div>
      )
    },
    size: 180,
  },

  // 상품 (SKU + 이름 + 옵션 + 수량 + 물류메세지)
  {
    id: 'productInfo',
    header: '상품',
    cell: ({ row }) => {
      const order = row.original
      const items = order.items
      if (!items || items.length === 0)
        return <span className="text-muted-foreground">-</span>
      const first = items[0]
      const extra = items.length - 1
      return (
        <div className="flex flex-col gap-0 text-xs leading-tight">
          {first.sku && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {first.sku}
            </span>
          )}
          <span className="max-w-[280px] truncate font-medium" title={first.productName}>
            {first.productName}
          </span>
          {first.optionText && (
            <span className="max-w-[280px] truncate text-[11px] text-muted-foreground" title={first.optionText}>
              {first.optionText}
            </span>
          )}
          <span className="text-[11px]">
            <span className="text-muted-foreground">수량</span>{' '}
            <span className="font-medium">{first.quantity}</span>
            {extra > 0 && (
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                +{extra}건
              </span>
            )}
          </span>
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
    },
    size: 300,
  },

  // 구매자 / 수취인 — 둘 다 표시 (연락처는 tooltip)
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
  // CS — 클레임/미발송
  {
    id: 'cs',
    header: 'CS',
    cell: ({ row }) => {
      const order = row.original
      if (order.claimId && order.claimType && order.claimStatus) {
        return (
          <ClaimStatusActions
            claimId={order.claimId}
            claimType={order.claimType}
            claimStatus={order.claimStatus}
            reason={order.claimReason ?? null}
          />
        )
      }
      if (order.isHeld) {
        return (
          <div className="flex flex-col gap-0.5">
            <Badge variant="outline" className="border-purple-300 bg-purple-50 text-purple-700">
              미발송
            </Badge>
            {order.holdReason && (
              <span className="max-w-[180px] truncate text-xs text-muted-foreground" title={order.holdReason}>
                {order.holdReason}
              </span>
            )}
          </div>
        )
      }
      return <span className="text-xs text-muted-foreground">-</span>
    },
    size: 200,
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
