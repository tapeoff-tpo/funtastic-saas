'use client'

import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS, type OrderStatus, type ClaimType, type ClaimStatus } from '@/lib/orders/types'
import { StatusDropdown } from './status-actions'
import { HoldDialog } from './hold-dialog'
import { ClaimStatusActions } from './claim-status-actions'

/** Invoice upload status labels */
const INVOICE_STATUS_LABELS: Record<InvoiceUploadStatus, string> = {
  pending: '대기',
  uploading: '업로드중',
  uploaded: '완료',
  failed: '실패',
  confirmed: '확인됨',
}

/** Invoice status badge variant */
const INVOICE_STATUS_VARIANT: Record<InvoiceUploadStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  uploading: 'default',
  uploaded: 'secondary',
  failed: 'destructive',
  confirmed: 'secondary',
}

/** Invoice upload status type */
type InvoiceUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'confirmed'

/** Row shape for the order table (matches getOrders return) */
export interface OrderRow {
  id: string
  marketplaceId: string
  marketplaceOrderId: string
  buyerName: string
  status: OrderStatus
  orderedAt: Date | string
  totalAmount: string
  isHeld: boolean
  holdReason?: string | null
  claimType?: ClaimType | null
  claimId?: string | null
  claimStatus?: ClaimStatus | null
  claimReason?: string | null
  invoiceStatus?: InvoiceUploadStatus | null
  trackingNumber?: string | null
  mappingStatus?: 'mapped' | 'partial' | 'unmapped'
  items: {
    productName: string
    optionText: string | null
    quantity: number
  }[]
}

/** Status badge color mapping */
const STATUS_VARIANT: Record<OrderStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  new: 'default',
  confirmed: 'secondary',
  preparing: 'outline',
  shipped: 'secondary',
  delivering: 'default',
  delivered: 'secondary',
  cancelled: 'destructive',
}

/** Marketplace display names */
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

export const columns: ColumnDef<OrderRow>[] = [
  // Checkbox column for row selection (D-05)
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
    size: 40,
  },
  // 주문번호
  {
    accessorKey: 'marketplaceOrderId',
    header: '주문번호',
    cell: ({ row }) => (
      <Link
        href={`/orders/${row.original.id}`}
        className="font-mono text-sm text-primary hover:underline"
      >
        {row.getValue('marketplaceOrderId') as string}
      </Link>
    ),
    size: 180,
  },
  // 마켓
  {
    accessorKey: 'marketplaceId',
    header: '마켓',
    cell: ({ row }) => {
      const id = row.getValue('marketplaceId') as string
      return (
        <Badge variant="outline">
          {getMarketplaceLabel(id)}
        </Badge>
      )
    },
    size: 120,
  },
  // 상품명
  {
    id: 'productName',
    header: '상품명',
    cell: ({ row }) => {
      const items = row.original.items
      if (!items || items.length === 0) return <span className="text-muted-foreground">-</span>
      const first = items[0]
      const extra = items.length - 1
      return (
        <div className="max-w-[250px] truncate" title={first.productName}>
          {first.productName}
          {first.optionText && (
            <span className="ml-1 text-muted-foreground text-xs">
              ({first.optionText})
            </span>
          )}
          {extra > 0 && (
            <span className="ml-1 text-muted-foreground text-xs">
              +{extra}건
            </span>
          )}
        </div>
      )
    },
    size: 280,
  },
  // 구매자
  {
    accessorKey: 'buyerName',
    header: '구매자',
    size: 100,
  },
  // 상태 — 주문 상태만 (CS 상태는 별도 컬럼)
  {
    accessorKey: 'status',
    header: '상태',
    cell: ({ row }) => {
      const status = row.getValue('status') as OrderStatus
      return (
        <Badge variant={STATUS_VARIANT[status]}>
          {ORDER_STATUS_LABELS[status]}
        </Badge>
      )
    },
    size: 100,
  },
  // 주문일
  {
    accessorKey: 'orderedAt',
    header: '주문일',
    cell: ({ row }) => {
      const date = row.getValue('orderedAt')
      if (!date) return '-'
      return format(new Date(date as string | Date), 'yyyy-MM-dd HH:mm')
    },
    size: 140,
  },
  // 금액
  {
    accessorKey: 'totalAmount',
    header: '금액',
    cell: ({ row }) => {
      const amount = row.getValue('totalAmount') as string
      const num = Number(amount)
      if (Number.isNaN(num)) return '-'
      return `${num.toLocaleString('ko-KR')}원`
    },
    size: 110,
  },
  // CS — 클레임 상태 전환 + 보류 사유
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
    size: 240,
  },
  // 송장상태
  {
    id: 'invoiceStatus',
    header: '송장상태',
    cell: ({ row }) => {
      const invoiceStatus = row.original.invoiceStatus
      const trackingNumber = row.original.trackingNumber
      if (!invoiceStatus) return <span className="text-muted-foreground">-</span>
      return (
        <div className="flex flex-col gap-0.5">
          <Badge variant={INVOICE_STATUS_VARIANT[invoiceStatus]}>
            {INVOICE_STATUS_LABELS[invoiceStatus]}
          </Badge>
          {trackingNumber && (
            <span className="font-mono text-xs text-muted-foreground">
              {trackingNumber}
            </span>
          )}
        </div>
      )
    },
    size: 120,
  },
  // 액션
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => {
      const order = row.original
      return (
        <div className="flex items-center gap-1">
          <StatusDropdown
            orderId={order.id}
            currentStatus={order.status}
            isHeld={order.isHeld}
          />
          <HoldDialog
            orderId={order.id}
            isHeld={order.isHeld}
            holdReason={order.holdReason}
          />
        </div>
      )
    },
    enableSorting: false,
    enableHiding: false,
    size: 180,
  },
]
