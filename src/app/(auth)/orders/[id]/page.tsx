import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getOrderById, getStockDeductionPreview } from '@/lib/orders/queries'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/orders/types'
import { getUserDisplayNames } from '@/lib/supabase/admin'
import { ClaimList } from './client'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

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

const SCAN_STATUS_LABELS: Record<string, string> = {
  ok: '정상',
  duplicate: '중복',
  not_found: '비정상',
}

/** yyyy-MM-dd HH:mm:ss 포맷 (없으면 '-') */
function fmtDateTime(value: Date | string | null | undefined): string {
  if (!value) return '-'
  return format(new Date(value), 'yyyy-MM-dd HH:mm:ss')
}

/** 기본 표기 연락처: phone2(휴대폰) 우선, 없으면 phone1(일반전화). */
function primaryPhone(phone1?: string | null, phone2?: string | null): string {
  return (phone2 ?? phone1 ?? '').trim() || '-'
}

type SabangnetRawData = {
  source?: string
  mallName?: string
  mallAccount?: string
  originalStatus?: string
  note?: string
  rows?: Array<{
    sourceFile?: string
    rowNumber?: number
    raw?: Record<string, string>
  }>
}

function getSabangnetRawData(rawData: unknown): SabangnetRawData | null {
  if (!rawData || typeof rawData !== 'object') return null
  const data = rawData as SabangnetRawData
  return data.source === 'sabangnet-history-xlsx' ? data : null
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
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const order = await getOrderById(id, workspaceUserId)
  if (!order) notFound()

  const stockPreview = await getStockDeductionPreview(id, workspaceUserId)
  const alreadyShipped = order.status === 'shipped' || order.status === 'delivering' || order.status === 'delivered'

  const shippingAddr = order.shippingAddress as
    | { zipCode: string; address1: string; address2?: string }
    | null
  const sabangnetRaw = getSabangnetRawData(order.rawData)

  // 매핑자/스캔자 사용자 ID 모음 → 이름 일괄 조회
  // 신규 컬럼이라 기존 데이터가 없는 주문은 scanLogs/shipments 가 비어 있을 수 있음 → 방어적 fallback
  const scanLogList = (order as { scanLogs?: typeof order.scanLogs }).scanLogs ?? []
  const shipmentList = (order as { shipments?: typeof order.shipments }).shipments ?? []
  const claimList = (order as { claims?: typeof order.claims }).claims ?? []
  const userIds = [
    order.mappedByUserId ?? null,
    ...scanLogList.map((s) => s.userId),
  ].filter((x): x is string => Boolean(x))
  const userNames = userIds.length > 0 ? await getUserDisplayNames(userIds) : new Map<string, string>()
  const mapperName = order.mappedByUserId ? userNames.get(order.mappedByUserId) ?? null : null

  // 클레임에서 가장 이른 접수일 / 가장 최근 완료일
  const claimRequestedAt = claimList.length > 0
    ? claimList.reduce<Date | null>((min, c) => {
        const t = new Date(c.requestedAt)
        return !min || t < min ? t : min
      }, null)
    : null
  const completedClaims = claimList.filter((c) => c.claimStatus === 'completed')
  const claimCompletedAt = completedClaims.length > 0
    ? completedClaims.reduce<Date | null>((max, c) => {
        const t = new Date(c.updatedAt)
        return !max || t > max ? t : max
      }, null)
    : null

  return (
    <div className="space-y-6">
      {/* Breadcrumb + title + status */}
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{order.marketplaceOrderId}</h1>
              {/* 상단 주문상태 배지 — 더 크고 눈에 띄게 */}
              <span className="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground">
                {ORDER_STATUS_LABELS[order.status as OrderStatus]}
              </span>
              {order.isHeld && (
                <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
                  보류중
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.marketplaceId} · {fmtDateTime(order.orderedAt)}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column (2/3) */}
        <div className="space-y-6 lg:col-span-2">
          {/* 배송 정보 */}
          <section className="rounded-lg border bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">배송 정보</h2>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">구매자</dt>
              <dd>
                {order.buyerName}
                <span className="ml-2 text-xs text-muted-foreground">
                  {primaryPhone(order.buyerPhone, order.buyerPhone2)}
                </span>
              </dd>

              <dt className="text-muted-foreground">구매자 전화1</dt>
              <dd className="text-xs text-muted-foreground">{order.buyerPhone || '-'}</dd>

              <dt className="text-muted-foreground">구매자 전화2 (휴대폰)</dt>
              <dd className="text-xs text-muted-foreground">{order.buyerPhone2 || '-'}</dd>

              <dt className="text-muted-foreground">수령인</dt>
              <dd>
                {order.recipientName}
                <span className="ml-2 text-xs text-muted-foreground">
                  {primaryPhone(order.recipientPhone, order.recipientPhone2)}
                </span>
              </dd>

              <dt className="text-muted-foreground">수령인 전화1</dt>
              <dd className="text-xs text-muted-foreground">{order.recipientPhone || '-'}</dd>

              <dt className="text-muted-foreground">수령인 전화2 (휴대폰)</dt>
              <dd className="text-xs text-muted-foreground">{order.recipientPhone2 || '-'}</dd>

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

              <dt className="text-muted-foreground">총 금액</dt>
              <dd className="font-semibold">
                {Number(order.totalAmount).toLocaleString('ko-KR')}원
              </dd>

              {order.isHeld && (
                <>
                  <dt className="text-muted-foreground">보류 사유</dt>
                  <dd className="text-red-600">{order.holdReason ?? '(사유 없음)'}</dd>
                </>
              )}
            </dl>
          </section>

          {/* 주문 상품 */}
          <section className="rounded-lg border bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">
              주문 상품 ({order.items.length}건)
            </h2>
            <ul className="divide-y">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-4 py-3 text-sm">
                  <div className="flex-1 space-y-1">
                    {/* 수집상품명 */}
                    <div className="flex gap-2">
                      <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        수집상품명
                      </span>
                      <span>{item.productName}</span>
                    </div>
                    {/* 확정상품명 + 옵션 — 같은 라인에 정렬 */}
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        확정상품명
                      </span>
                      {item.displayName ? (
                        <span className="font-medium">{item.displayName}</span>
                      ) : (
                        <span className="italic text-muted-foreground">미매핑</span>
                      )}
                      {item.optionText && (
                        <span className="text-xs text-muted-foreground">
                          · 옵션: {item.optionText}
                        </span>
                      )}
                    </div>
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

          {sabangnetRaw && (
            <section className="rounded-lg border bg-white p-5">
              <h2 className="mb-3 text-lg font-semibold">사방넷 원본 정보</h2>
              <dl className="mb-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">쇼핑몰</dt>
                <dd>{sabangnetRaw.mallName} {sabangnetRaw.mallAccount ? `(${sabangnetRaw.mallAccount})` : ''}</dd>
                <dt className="text-muted-foreground">원본 주문상태</dt>
                <dd>{sabangnetRaw.originalStatus ?? '-'}</dd>
                <dt className="text-muted-foreground">비고</dt>
                <dd className="text-muted-foreground">{sabangnetRaw.note ?? '-'}</dd>
              </dl>
              <div className="overflow-x-auto rounded-md border">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">파일</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">행</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">쇼핑몰 상품코드</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">수집 상품명</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">수집 옵션</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium">주문수량</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">사방넷 상품코드</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">택배사</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium">송장번호</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(sabangnetRaw.rows ?? []).map((row, index) => {
                      const raw = row.raw ?? {}
                      return (
                        <tr key={`${row.sourceFile ?? 'row'}-${row.rowNumber ?? index}`}>
                          <td className="whitespace-nowrap px-2 py-1.5">{row.sourceFile ?? '-'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{row.rowNumber ?? '-'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">{raw['쇼핑몰 상품코드'] ?? '-'}</td>
                          <td className="min-w-[220px] px-2 py-1.5">{raw['수집 상품명'] ?? '-'}</td>
                          <td className="min-w-[140px] px-2 py-1.5">{raw['수집 옵션'] ?? '-'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right">{raw['주문수량'] ?? '-'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">{raw['사방넷 상품코드'] ?? '-'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{raw['택배사'] ?? '-'}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 font-mono">{raw['송장번호'] ?? '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 주문 상태 — 진행 시점 타임라인 */}
          <section className="rounded-lg border bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">주문 상태</h2>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">실제 마켓 주문일자</dt>
              <dd className="font-mono">{fmtDateTime(order.orderedAt)}</dd>

              <dt className="text-muted-foreground">주문수집일</dt>
              <dd className="font-mono">{fmtDateTime(order.collectedAt)}</dd>

              <dt className="text-muted-foreground">매핑일자</dt>
              <dd className="font-mono">
                {fmtDateTime(order.mappedAt)}
                {mapperName && (
                  <span className="ml-2 font-sans text-xs text-muted-foreground">
                    ({mapperName})
                  </span>
                )}
              </dd>

              <dt className="text-muted-foreground">출고준비일자</dt>
              <dd className="font-mono">{fmtDateTime(order.preparingAt)}</dd>

              <dt className="text-muted-foreground">출고완료일자</dt>
              <dd className="font-mono">{fmtDateTime(order.shipment?.shippedAt)}</dd>

              <dt className="text-muted-foreground">송장송신일자</dt>
              <dd className="font-mono">{fmtDateTime(order.shipment?.lastUploadAt)}</dd>

              <dt className="text-muted-foreground">반품/교환 접수일자</dt>
              <dd className="font-mono">{fmtDateTime(claimRequestedAt)}</dd>

              <dt className="text-muted-foreground">반품/교환 완료일자</dt>
              <dd className="font-mono">{fmtDateTime(claimCompletedAt)}</dd>
            </dl>
          </section>

          {/* 송장정보 */}
          <section className="rounded-lg border bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">송장정보</h2>
            {shipmentList.length === 0 ? (
              <p className="text-sm text-muted-foreground">등록된 송장이 없습니다.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {shipmentList.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-4 rounded border bg-gray-50 px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{s.carrierName}</span>
                      <span className="font-mono">{s.trackingNumber}</span>
                    </div>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">
                      {s.uploadStatus}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 클레임 */}
          {claimList.length > 0 && (
            <section className="rounded-lg border bg-white p-5">
              <h2 className="mb-3 text-lg font-semibold">클레임</h2>
              <ClaimList
                claims={claimList.map((c) => ({
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

          {/* 바코드 스캔 여부 — 가장 하단 */}
          <section className="rounded-lg border bg-white p-5">
            <h2 className="mb-3 text-lg font-semibold">바코드 스캔 여부</h2>
            {scanLogList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                스캔 이력이 없습니다.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {scanLogList.map((log) => {
                  // 정상=Y-Y, 비정상/중복=Y-N (스캔 자체는 완료되었으나 정상 처리 X)
                  const code = log.status === 'ok' ? 'Y-Y' : 'Y-N'
                  const colorClass =
                    log.status === 'ok'
                      ? 'bg-green-100 text-green-700'
                      : log.status === 'duplicate'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                  const scannerName = userNames.get(log.userId) ?? log.userId.slice(0, 8)
                  return (
                    <li
                      key={log.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border bg-gray-50 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${colorClass}`}>
                          {code} · {SCAN_STATUS_LABELS[log.status] ?? log.status}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {fmtDateTime(log.scannedAt)}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        스캔: {scannerName}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Right column: 재고 차감 미리보기 */}
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
