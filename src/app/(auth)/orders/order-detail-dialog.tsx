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

const SCAN_STATUS_LABELS: Record<string, string> = {
  ok: '정상',
  duplicate: '중복',
  not_found: '비정상',
}

interface OrderDetail {
  id: string
  marketplaceOrderId: string
  marketplaceId: string
  status: OrderStatus
  orderedAt: string
  collectedAt?: string | null
  mappedAt?: string | null
  mappedByUserId?: string | null
  preparingAt?: string | null
  totalAmount: string
  buyerName: string
  buyerPhone: string | null
  buyerPhone2?: string | null
  recipientName: string
  recipientPhone: string | null
  recipientPhone2?: string | null
  shippingAddress: {
    zipCode: string
    address1: string
    address2?: string
  } | null
  isHeld: boolean
  holdReason: string | null
  logisticsMessage?: string | null
  deliveryMessage?: string | null
  items: Array<{
    id: string
    productName: string
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
    updatedAt?: string
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
    shippedAt?: string | null
    lastUploadAt?: string | null
  } | null
  shipments?: Array<{
    id: string
    carrierName: string
    trackingNumber: string
    uploadStatus: string
    shippedAt?: string | null
    lastUploadAt?: string | null
  }>
  scanLogs?: Array<{
    id: string
    userId: string
    status: string
    scannedAt: string
  }>
}

interface Props {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** yyyy-MM-dd HH:mm:ss 포맷 (없으면 '-') */
function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-'
  return format(new Date(value), 'yyyy-MM-dd HH:mm:ss')
}

/** 기본 표기 연락처: phone2(휴대폰) 우선, 없으면 phone1(일반전화) */
function primaryPhone(phone1?: string | null, phone2?: string | null): string {
  return ((phone2 ?? phone1) ?? '').trim() || '-'
}

/**
 * Modal replacement for /orders/[id] — fetches detail on open,
 * 페이지(/orders/[id]) 와 동일한 섹션 구성:
 * 배송정보(전화1/2 분리) · 주문상품 · 주문상태(8단계 타임라인) · 송장정보 · 바코드 스캔 여부 · 클레임 · CS메모.
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
  const shipmentList = order?.shipments ?? (order?.shipment
    ? [{ id: 'legacy', ...order.shipment }]
    : [])
  const scanLogList = order?.scanLogs ?? []
  const claimList = order?.claims ?? []

  // 클레임 접수 가장 이른 / 완료 가장 최근
  const claimRequestedAt = claimList.length > 0
    ? claimList.reduce<Date | null>((min, c) => {
        const t = new Date(c.requestedAt)
        return !min || t < min ? t : min
      }, null)
    : null
  const completedClaims = claimList.filter((c) => c.claimStatus === 'completed')
  const claimCompletedAt = completedClaims.length > 0
    ? completedClaims.reduce<Date | null>((max, c) => {
        const t = new Date(c.updatedAt ?? c.requestedAt)
        return !max || t > max ? t : max
      }, null)
    : null

  // 출고완료/송장송신 시점은 가장 최근 송장 기준
  const latestShipment = shipmentList.length > 0
    ? shipmentList.reduce((prev, cur) => {
        const p = prev.shippedAt ? new Date(prev.shippedAt).getTime() : 0
        const c = cur.shippedAt ? new Date(cur.shippedAt).getTime() : 0
        return c > p ? cur : prev
      })
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              주문상세정보
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <h2 className="text-lg font-bold">
                {order?.marketplaceOrderId ?? '로딩 중...'}
              </h2>
              {order && (
                <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                  {ORDER_STATUS_LABELS[order.status]}
                </span>
              )}
              {order?.isHeld && (
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                  보류중
                </span>
              )}
            </div>
            {order && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {order.marketplaceId} · {fmtDateTime(order.orderedAt)}
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
              {/* Left 2/3 */}
              <div className="space-y-4 lg:col-span-2">
                {/* 배송 정보 */}
                <section className="rounded-md border p-3 text-sm">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    배송 정보
                  </h3>
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">구매자</dt>
                    <dd>
                      {order.buyerName}
                      <span className="ml-2 font-mono text-muted-foreground">
                        {primaryPhone(order.buyerPhone, order.buyerPhone2)}
                      </span>
                    </dd>

                    <dt className="text-muted-foreground">구매자 전화1</dt>
                    <dd className="font-mono text-muted-foreground">{order.buyerPhone || '-'}</dd>

                    <dt className="text-muted-foreground">구매자 전화2 (휴대폰)</dt>
                    <dd className="font-mono text-muted-foreground">{order.buyerPhone2 || '-'}</dd>

                    <dt className="text-muted-foreground">수취인</dt>
                    <dd>
                      {order.recipientName}
                      <span className="ml-2 font-mono text-muted-foreground">
                        {primaryPhone(order.recipientPhone, order.recipientPhone2)}
                      </span>
                    </dd>

                    <dt className="text-muted-foreground">수취인 전화1</dt>
                    <dd className="font-mono text-muted-foreground">{order.recipientPhone || '-'}</dd>

                    <dt className="text-muted-foreground">수취인 전화2 (휴대폰)</dt>
                    <dd className="font-mono text-muted-foreground">{order.recipientPhone2 || '-'}</dd>

                    <dt className="text-muted-foreground">배송지</dt>
                    <dd>
                      {shippingAddr
                        ? `[${shippingAddr.zipCode}] ${shippingAddr.address1}${
                            shippingAddr.address2 ? ` ${shippingAddr.address2}` : ''
                          }`
                        : '-'}
                    </dd>

                    <dt className="text-muted-foreground">배송메세지</dt>
                    <dd className="whitespace-pre-wrap">{order.deliveryMessage || '-'}</dd>

                    {order.logisticsMessage && (
                      <>
                        <dt className="text-muted-foreground">물류메세지</dt>
                        <dd className="font-medium text-blue-700">
                          {order.logisticsMessage}
                        </dd>
                      </>
                    )}

                    <dt className="text-muted-foreground">총 금액</dt>
                    <dd className="font-medium">
                      {Number(order.totalAmount).toLocaleString('ko-KR')}원
                    </dd>

                    {order.isHeld && (
                      <>
                        <dt className="text-muted-foreground">보류 사유</dt>
                        <dd className="text-red-600">
                          {order.holdReason ?? '(사유 없음)'}
                        </dd>
                      </>
                    )}
                  </dl>
                </section>

                {/* 주문 상품 */}
                <section className="rounded-md border p-3">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    주문 상품 ({order.items.length}건)
                  </h3>
                  <ul className="divide-y text-sm">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-3 py-2">
                        <div className="flex-1 space-y-1">
                          <div className="flex gap-2">
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              수집상품명
                            </span>
                            <span className="text-sm">{item.productName}</span>
                          </div>
                          <div className="flex flex-wrap items-baseline gap-2">
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
                            {item.optionText && (
                              <span className="text-xs text-muted-foreground">
                                · 옵션: {item.optionText}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          {Number(item.unitPrice).toLocaleString('ko-KR')}원 × {item.quantity}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* 주문 상태 — 진행 시점 타임라인 */}
                <section className="rounded-md border p-3 text-sm">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    주문 상태
                  </h3>
                  <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">실제 마켓 주문일자</dt>
                    <dd className="font-mono">{fmtDateTime(order.orderedAt)}</dd>

                    <dt className="text-muted-foreground">주문수집일</dt>
                    <dd className="font-mono">{fmtDateTime(order.collectedAt)}</dd>

                    <dt className="text-muted-foreground">매핑일자</dt>
                    <dd className="font-mono">
                      {fmtDateTime(order.mappedAt)}
                      {order.mappedByUserId && (
                        <span className="ml-2 font-sans text-[10px] text-muted-foreground">
                          ({order.mappedByUserId.slice(0, 8)})
                        </span>
                      )}
                    </dd>

                    <dt className="text-muted-foreground">출고준비일자</dt>
                    <dd className="font-mono">{fmtDateTime(order.preparingAt)}</dd>

                    <dt className="text-muted-foreground">출고완료일자</dt>
                    <dd className="font-mono">{fmtDateTime(latestShipment?.shippedAt)}</dd>

                    <dt className="text-muted-foreground">송장송신일자</dt>
                    <dd className="font-mono">{fmtDateTime(latestShipment?.lastUploadAt)}</dd>

                    <dt className="text-muted-foreground">반품/교환 접수일자</dt>
                    <dd className="font-mono">{fmtDateTime(claimRequestedAt)}</dd>

                    <dt className="text-muted-foreground">반품/교환 완료일자</dt>
                    <dd className="font-mono">{fmtDateTime(claimCompletedAt)}</dd>
                  </dl>
                </section>

                {/* 송장정보 */}
                <section className="rounded-md border p-3 text-sm">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    송장정보
                  </h3>
                  {shipmentList.length === 0 ? (
                    <p className="text-xs text-muted-foreground">등록된 송장이 없습니다.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs">
                      {shipmentList.map((s) => (
                        <li
                          key={s.id}
                          className="flex items-center justify-between gap-3 rounded border bg-gray-50 px-2.5 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{s.carrierName}</span>
                            <span className="font-mono">{s.trackingNumber}</span>
                          </div>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                            {s.uploadStatus}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* 클레임 */}
                {claimList.length > 0 && (
                  <section className="rounded-md border p-3">
                    <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                      클레임
                    </h3>
                    <ClaimList
                      claims={claimList}
                      typeLabels={CLAIM_TYPE_LABELS}
                      statusLabels={CLAIM_STATUS_LABELS}
                    />
                  </section>
                )}

                {/* 바코드 스캔 여부 */}
                <section className="rounded-md border p-3 text-sm">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    바코드 스캔 여부
                  </h3>
                  {scanLogList.length === 0 ? (
                    <p className="text-xs text-muted-foreground">스캔 이력이 없습니다.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs">
                      {scanLogList.map((log) => {
                        const code = log.status === 'ok' ? 'Y-Y' : 'Y-N'
                        const colorClass =
                          log.status === 'ok'
                            ? 'bg-green-100 text-green-700'
                            : log.status === 'duplicate'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-red-100 text-red-700'
                        return (
                          <li
                            key={log.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border bg-gray-50 px-2.5 py-1.5"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${colorClass}`}>
                                {code} · {SCAN_STATUS_LABELS[log.status] ?? log.status}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {fmtDateTime(log.scannedAt)}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              스캔: {log.userId.slice(0, 8)}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              </div>

              {/* Right: CS 메모 */}
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
