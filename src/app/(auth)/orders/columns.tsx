'use client'

import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS, type OrderStatus, type ClaimType } from '@/lib/orders/types'
import { StatusDropdown } from './status-actions'
import { HoldDialog } from './hold-dialog'
import { InlineMappingDialog } from './inline-mapping-dialog'

/** Mapping status cell — clickable badge that opens inline mapping dialog */
function MappingCell({ order }: { order: OrderRow }) {
  const [open, setOpen] = useState(false)
  const status = order.mappingStatus

  const handleClick = () => {
    if (status !== 'mapped') setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={status !== 'mapped' ? 'cursor-pointer' : 'cursor-default'}
        disabled={status === 'mapped'}
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
        items={order.items}
        onClose={() => setOpen(false)}
        onSaved={() => { window.location.reload() }}
      />
    </>
  )
}

/** Claim type Korean labels */
const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
}

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
      <span className="font-mono text-sm">
        {row.getValue('marketplaceOrderId')}
      </span>
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
  // 상태
  {
    accessorKey: 'status',
    header: '상태',
    cell: ({ row }) => {
      const status = row.getValue('status') as OrderStatus
      const isHeld = row.original.isHeld
      const holdReason = row.original.holdReason
      const claimType = row.original.claimType
      return (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={STATUS_VARIANT[status]}>
            {ORDER_STATUS_LABELS[status]}
          </Badge>
          {isHeld && (
            <Badge variant="destructive" title={holdReason ?? undefined}>
              보류
            </Badge>
          )}
          {claimType && (
            <Badge variant="outline" className="border-orange-300 text-orange-700">
              {CLAIM_TYPE_LABELS[claimType]}
            </Badge>
          )}
        </div>
      )
    },
    size: 160,
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
  // 매핑 상태 (클릭하면 인라인 매핑 모달)
  {
    id: 'mappingStatus',
    header: '매핑',
    cell: ({ row }) => <MappingCell order={row.original} />,
    size: 90,
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
