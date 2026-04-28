'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { ClaimList, MemoPanel } from './[id]/client'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/orders/types'

const CLAIM_TYPE_LABELS: Record<string, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
}

const CLAIM_STATUS_LABELS: Record<string, string> = {
  requested: '접수',
  processing: '처리중',
  completed: '완료',
  rejected: '거절',
}

interface OrderDetail {
  id: string
  marketplaceOrderId: string
  marketplaceId: string
  status: OrderStatus
  orderedAt: string
  totalAmount: string
  buyerName: string
  buyerPhone: string | null
  recipientName: string
  recipientPhone: string | null
  shippingAddress: {
    zipCode: string
    address1: string
    address2?: string
  } | null
  isHeld: boolean
  holdReason: string | null
  logisticsMessage?: string | null
  items: Array<{
    id: string
    /** 수집상품명 — 마켓에서 들어온 그대로 */
    productName: string
    /** 확정상품명 — product_name_mappings.display_name (매핑 안 됐으면 null) */
    displayName: string | null
    optionText: string | null
    quantity: number
    unitPrice: string
    sku: string | null
  }>
  claims: Array<{
    id: string
    claimType: string
    claimStatus: string
    reason: string | null
    requestedAt: string
  }>
  memos: Array<{
    id: string
    content: string
    memoType: string
    createdAt: string
  }>
  shipment: {
    carrierName: string
    trackingNumber: string
    uploadStatus: string
  } | null
}

interface Props {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Modal replacement for /orders/[id] — fetches detail on open,
 * renders items + claims (with status transitions) + CS memos in one dialog.
 */
export function OrderDetailDialog({ orderId, open, onOpenChange }: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!open || !orderId) return
    setLoading(true)
    fetch(`/api/orders/${orderId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => setOrder(data.order))
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : '주문을 불러올 수 없습니다')
        onOpenChange(false)
      })
      .finally(() => setLoading(false))
  }, [open, orderId, onOpenChange])

  if (!open) return null

  const shippingAddr = order?.shippingAddress

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              주문상세정보
            </p>
            <h2 className="text-lg font-bold">
              {order?.marketplaceOrderId ?? '로딩 중...'}
            </h2>
            {order && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {order.marketplaceId} · {format(new Date(order.orderedAt), 'yyyy-MM-dd HH:mm')} · {ORDER_STATUS_LABELS[order.status]}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
          >
            닫기 ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <p className="text-center text-sm text-muted-foreground">로딩 중...</p>
          )}
          {!loading && order && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Left 2/3: Order info + claims */}
              <div className="space-y-4 lg:col-span-2">
                {/* Buyer / Recipient / Address */}
                <section className="rounded-md border p-3 text-sm">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    배송 정보
                  </h3>
                  <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-xs">
                    <dt className="text-muted-foreground">구매자</dt>
                    <dd>
                      {order.buyerName}
                      {order.buyerPhone && (
                        <span className="ml-2 font-mono text-muted-foreground">
                          {order.buyerPhone}
                        </span>
                      )}
                    </dd>
                    <dt className="text-muted-foreground">수취인</dt>
                    <dd>
                      {order.recipientName}
                      {order.recipientPhone && (
                        <span className="ml-2 font-mono text-muted-foreground">
                          {order.recipientPhone}
                        </span>
                      )}
                    </dd>
                    <dt className="text-muted-foreground">배송지</dt>
                    <dd>
                      {shippingAddr
                        ? `[${shippingAddr.zipCode}] ${shippingAddr.address1}${
                            shippingAddr.address2 ? ` ${shippingAddr.address2}` : ''
                          }`
                        : '-'}
                    </dd>
                    <dt className="text-muted-foreground">총 금액</dt>
                    <dd className="font-medium">
                      {Number(order.totalAmount).toLocaleString('ko-KR')}원
                    </dd>
                    {order.shipment && (
                      <>
                        <dt className="text-muted-foreground">송장</dt>
                        <dd>
                          <span className="font-mono">
                            {order.shipment.carrierName} · {order.shipment.trackingNumber}
                          </span>
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                            {order.shipment.uploadStatus}
                          </span>
                        </dd>
                      </>
                    )}
                    {order.logisticsMessage && (
                      <>
                        <dt className="text-muted-foreground">물류메세지</dt>
                        <dd className="font-medium text-blue-700">
                          {order.logisticsMessage}
                        </dd>
                      </>
                    )}
                    {order.isHeld && (
                      <>
                        <dt className="text-muted-foreground">보류</dt>
                        <dd className="text-red-600">
                          {order.holdReason ?? '(사유 없음)'}
                        </dd>
                      </>
                    )}
                  </dl>
                </section>

                {/* Items */}
                <section className="rounded-md border p-3">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    주문 상품 ({order.items.length}건)
                  </h3>
                  <ul className="divide-y text-sm">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-3 py-2">
                        <div className="flex-1 space-y-1">
                          {/* 수집상품명 — 마켓에서 받아온 원본 */}
                          <div className="flex gap-2">
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              수집상품명
                            </span>
                            <span className="text-sm">{item.productName}</span>
                          </div>
                          {/* 확정상품명 — 매핑된 내부 상품명 (없으면 미매핑 표시) */}
                          <div className="flex gap-2">
                            <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                              확정상품명
                            </span>
                            {item.displayName ? (
                              <span className="text-sm font-medium">
                                {item.sku && (
                                  <span className="mr-2 font-mono text-[10px] text-muted-foreground">
                                    {item.sku}
                                  </span>
                                )}
                                {item.displayName}
                              </span>
                            ) : (
                              <span className="text-sm italic text-muted-foreground">미매핑</span>
                            )}
                          </div>
                          {item.optionText && (
                            <p className="text-xs text-muted-foreground">
                              옵션: {item.optionText}
                            </p>
                          )}
                        </div>
                        <div className="text-right text-xs">
                          {Number(item.unitPrice).toLocaleString('ko-KR')}원 × {item.quantity}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Claims */}
                {order.claims.length > 0 && (
                  <section className="rounded-md border p-3">
                    <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                      클레임
                    </h3>
                    <ClaimList
                      claims={order.claims}
                      typeLabels={CLAIM_TYPE_LABELS}
                      statusLabels={CLAIM_STATUS_LABELS}
                    />
                  </section>
                )}
              </div>

              {/* Right: memos */}
              <div className="lg:col-span-1">
                <section className="rounded-md border p-3">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    CS 메모
                  </h3>
                  <MemoPanel orderId={order.id} initialMemos={order.memos} />
                </section>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={() => {
              if (orderId) router.push(`/orders/${orderId}`)
            }}
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
          >
            전체 페이지 열기
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
