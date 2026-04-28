import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getOrderById, getStockDeductionPreview } from '@/lib/orders/queries'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/orders/types'
import { ClaimList } from './client'

export const metadata: Metadata = {
  title: '주문 상세',
}

const CLAIM_TYPE_LABELS: Record<string, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
}

const CLAIM_STATUS_LABELS: Record<string, string> = {
  requested: '접수됨',
  processing: '처리중',
  completed: '완료',
  rejected: '거절',
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const order = await getOrderById(id, user.id)
  if (!order) notFound()

  const stockPreview = await getStockDeductionPreview(id, user.id)
  const alreadyShipped = order.status === 'shipped' || order.status === 'delivering' || order.status === 'delivered'

  const shippingAddr = order.shippingAddress as
    | { zipCode: string; address1: string; address2?: string }
    | null

  return (
    <div className="space-y-6">
      {/* Breadcrumb + title */}
      <div>
        <nav className="mb-1 text-sm text-muted-foreground">
          <Link href="/orders" className="hover:underline">
            주문 관리
          </Link>
          <span className="mx-2">/</span>
          <span>주문 상세</span>
        </nav>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          주문상세정보
        </p>
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {order.marketplaceOrderId}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.marketplaceId} · {format(new Date(order.orderedAt), 'yyyy-MM-dd HH:mm')}
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
            {ORDER_STATUS_LABELS[order.status as OrderStatus]}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column (2/3): order details */}
        <div className="space-y-6 lg:col-span-2">
          {/* Buyer + recipient + shipping address */}
          <section className="rounded-lg border bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">배송 정보</h2>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">구매자</dt>
              <dd>
                {order.buyerName}
                {order.buyerPhone && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {order.buyerPhone}
                  </span>
                )}
              </dd>
              <dt className="text-muted-foreground">수령인</dt>
              <dd>
                {order.recipientName}
                {order.recipientPhone && (
                  <span className="ml-2 text-xs text-muted-foreground">
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
              <dd className="font-semibold">
                {Number(order.totalAmount).toLocaleString('ko-KR')}원
              </dd>
              {order.shipment && (
                <>
                  <dt className="text-muted-foreground">송장</dt>
                  <dd>
                    <span className="font-mono">
                      {order.shipment.carrierName} · {order.shipment.trackingNumber}
                    </span>
                    <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">
                      {order.shipment.uploadStatus}
                    </span>
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
          <section className="rounded-lg border bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">
              주문 상품 ({order.items.length}건)
            </h2>
            <ul className="divide-y">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-4 py-3 text-sm">
                  <div className="flex-1 space-y-1">
                    {/* 수집상품명 — 마켓에서 받아온 원본 */}
                    <div className="flex gap-2">
                      <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        수집상품명
                      </span>
                      <span>{item.productName}</span>
                    </div>
                    {/* 확정상품명 — product_name_mappings.display_name */}
                    <div className="flex gap-2">
                      <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        확정상품명
                      </span>
                      {item.displayName ? (
                        <span className="font-medium">{item.displayName}</span>
                      ) : (
                        <span className="italic text-muted-foreground">미매핑</span>
                      )}
                    </div>
                    {item.optionText && (
                      <p className="text-xs text-muted-foreground">
                        옵션: {item.optionText}
                      </p>
                    )}
                    {item.sku && (
                      <p className="mt-1 text-xs font-mono text-muted-foreground">
                        SKU: {item.sku}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p>
                      {Number(item.unitPrice).toLocaleString('ko-KR')}원 × {item.quantity}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Claims */}
          {order.claims.length > 0 && (
            <section className="rounded-lg border bg-white p-5">
              <h2 className="mb-3 text-lg font-semibold">클레임</h2>
              <ClaimList
                claims={order.claims.map((c) => ({
                  id: c.id,
                  claimType: c.claimType,
                  claimStatus: c.claimStatus,
                  reason: c.reason,
                  requestedAt: c.requestedAt.toISOString(),
                }))}
                typeLabels={CLAIM_TYPE_LABELS}
                statusLabels={CLAIM_STATUS_LABELS}
              />
            </section>
          )}
        </div>

        {/* Right column: stock deduction preview */}
        <div className="lg:col-span-1">
          <section className="rounded-lg border bg-white p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">
                {alreadyShipped ? '차감된 재고' : '예상 차감 재고'}
              </h2>
              {!alreadyShipped && (
                <span className="text-xs text-muted-foreground">
                  출고완료 시점 차감 예상치
                </span>
              )}
            </div>

            {stockPreview.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                매핑된 SKU가 없어 차감 내역을 계산할 수 없습니다.
                <br />
                먼저 주문 매핑을 완료하세요.
              </p>
            ) : (
              <ul className="space-y-2">
                {stockPreview.map((row) => {
                  const missing = row.totalStock === null
                  const insufficient = !missing && !row.sufficient
                  return (
                    <li
                      key={row.sku}
                      className={`rounded-md border p-3 text-sm ${
                        missing
                          ? 'border-red-300 bg-red-50'
                          : insufficient
                            ? 'border-amber-300 bg-amber-50'
                            : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {row.sku}
                          </p>
                          <p className="truncate font-medium">
                            {row.productName ?? '(재고 미등록)'}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
                            missing || insufficient
                              ? 'bg-red-100 text-red-700'
                              : 'bg-green-100 text-green-700'
                          }`}
                        >
                          -{row.requiredQty}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center gap-2 text-xs">
                        {row.isBundleComponent && (
                          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                            세트구성품
                          </span>
                        )}
                        {missing ? (
                          <span className="text-red-700">재고 레코드 없음</span>
                        ) : (
                          <span className={insufficient ? 'text-amber-700' : 'text-muted-foreground'}>
                            가용 {row.availableStock ?? 0} / 총 {row.totalStock ?? 0}
                            {insufficient && ' (부족!)'}
                          </span>
                        )}
                      </div>

                      {row.sourceItems.length > 0 && (
                        <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                          <span className="text-[10px] uppercase tracking-wide">출처</span>
                          <ul className="mt-1 space-y-0.5">
                            {row.sourceItems.map((s, i) => (
                              <li key={i} className="truncate">
                                · {s.productName}
                                {s.optionText && ` (${s.optionText})`} × {s.orderQty}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
