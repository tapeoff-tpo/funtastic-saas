'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { ClaimList, MemoPanel } from './[id]/client'
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/orders/types'
import { usesSkuMappingKey } from '@/lib/orders/mapping-key-marketplaces'

const EDITABLE_CONFIRMED_ITEM_STATUSES = new Set<OrderStatus>(['new', 'confirmed', 'preparing', 'ready'])

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

const CHANGE_ACTION_LABELS: Record<string, string> = {
  'status.changed': '주문상태변경',
  'status.confirmed': '확정',
  'status.shipped': '출고완료',
  'mapping.applied': '매핑완료',
  'mapping.removed': '매핑해제',
  'invoice.registered': '송장번호등록',
  'invoice.send_requested': '송장 송신시작',
  'invoice.sent': '송장 송신',
  'claim.created': '클레임접수',
}

function displayCollectedProductCode(
  marketplaceId: string,
  item: { sku?: string | null; marketplaceItemId?: string | null },
): string | null {
  return usesSkuMappingKey(marketplaceId) && item.sku
    ? item.sku
    : item.marketplaceItemId ?? null
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
  rawData?: {
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
  } | null
  items: Array<{
    id: string
    marketplaceItemId?: string | null
    productName: string
    displayName: string | null
    displayOptionName?: string | null
    optionText: string | null
    quantity: number
    unitPrice: string
    sku: string | null
    lockedAt?: string | null
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
    attachments?: Array<{
      name: string
      type: string
      dataUrl: string
      size: number
    }>
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
  changeLogs?: Array<{
    id: string
    action: string
    title: string
    description: string | null
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    metadata?: Record<string, unknown> | null
    actorId?: string | null
    createdAt: string
  }>
}

interface Props {
  orderId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ProductSearchResult {
  id: string
  internalSku: string
  name: string
  optionName?: string | null
  optionHint?: string | null
  availableStock?: number | null
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

function getSabangnetRawData(order: OrderDetail | null) {
  return order?.rawData?.source === 'sabangnet-history-xlsx' ? order.rawData : null
}

/**
 * Modal replacement for /orders/[id] — fetches detail on open,
 * 페이지(/orders/[id]) 와 동일한 섹션 구성:
 * 배송정보(전화1/2 분리) · 주문상품 · 주문상태(8단계 타임라인) · 송장정보 · 바코드 스캔 여부 · 클레임 · CS메모.
 */
export function OrderDetailDialog({ orderId, open, onOpenChange }: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editingItems, setEditingItems] = useState(false)
  const [savingItems, setSavingItems] = useState(false)
  const [itemDrafts, setItemDrafts] = useState<Record<string, {
    sku: string
    productName: string
    optionName: string
    quantity: number
  }>>({})
  const [itemSearchTerms, setItemSearchTerms] = useState<Record<string, string>>({})
  const [itemSearchResults, setItemSearchResults] = useState<Record<string, ProductSearchResult[]>>({})
  const router = useRouter()

  useEffect(() => {
    if (!open || !orderId) return
    Promise.resolve().then(() => setLoading(true))
    Promise.resolve().then(() => setHistoryOpen(false))
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

  useEffect(() => {
    if (!order) return
    setItemDrafts(Object.fromEntries(order.items.map((item) => [
      item.id,
      {
        sku: item.sku ?? '',
        productName: item.displayName ?? item.productName,
        optionName: item.displayOptionName ?? item.optionText ?? '',
        quantity: item.quantity,
      },
    ])))
    setEditingItems(false)
    setSavingItems(false)
    setItemSearchTerms({})
    setItemSearchResults({})
  }, [order])

  const updateItemDraft = (
    itemId: string,
    patch: Partial<{ sku: string; productName: string; optionName: string; quantity: number }>,
  ) => {
    setItemDrafts((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        ...patch,
      },
    }))
  }

  const searchProductsForItem = async (itemId: string, query: string) => {
    const q = query.trim()
    setItemSearchTerms((prev) => ({ ...prev, [itemId]: query }))
    if (!q) {
      setItemSearchResults((prev) => ({ ...prev, [itemId]: [] }))
      return
    }

    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&mode=option`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { results?: ProductSearchResult[] }
      setItemSearchResults((prev) => ({ ...prev, [itemId]: data.results ?? [] }))
    } catch {
      setItemSearchResults((prev) => ({ ...prev, [itemId]: [] }))
    }
  }

  const selectProductForItem = (itemId: string, product: ProductSearchResult) => {
    updateItemDraft(itemId, {
      sku: product.internalSku,
      productName: product.name,
      optionName: product.optionName ?? product.optionHint ?? '',
    })
    setItemSearchTerms((prev) => ({ ...prev, [itemId]: product.internalSku }))
    setItemSearchResults((prev) => ({ ...prev, [itemId]: [] }))
  }

  const saveItemDrafts = async () => {
    if (!order) return
    const payload = order.items.map((item) => {
      const draft = itemDrafts[item.id]
      return {
        id: item.id,
        productName: draft?.productName ?? item.displayName ?? item.productName,
        optionName: draft?.optionName ?? item.displayOptionName ?? item.optionText ?? '',
        quantity: draft?.quantity ?? item.quantity,
        sku: draft?.sku ?? item.sku ?? '',
        searchQuery: itemSearchTerms[item.id]?.trim() || undefined,
      }
    })
    const invalid = payload.find((item) => !item.productName.trim() || !Number.isInteger(item.quantity) || item.quantity < 1)
    if (invalid) {
      toast.error('확정상품명과 1 이상의 정수 수량을 입력해주세요.')
      return
    }

    setSavingItems(true)
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      })
      const data = await res.json().catch(() => ({})) as { order?: OrderDetail; error?: string }
      if (!res.ok || !data.order) {
        toast.error(data.error ?? '확정상품 수정에 실패했습니다.')
        return
      }
      setOrder(data.order)
      setEditingItems(false)
      toast.success('확정상품 정보를 저장했습니다.')
      router.refresh()
    } finally {
      setSavingItems(false)
    }
  }

  if (!open) return null

  const shippingAddr = order?.shippingAddress
  const shipmentList = order?.shipments ?? (order?.shipment
    ? [{ id: 'legacy', ...order.shipment }]
    : [])
  const scanLogList = order?.scanLogs ?? []
  const claimList = order?.claims ?? []
  const changeLogList = order?.changeLogs ?? []
  const sabangnetRaw = getSabangnetRawData(order)

  // 클레임 접수 가장 이른 / 완료 가장 최근
  const claimRequestedAt = claimList.length > 0
    ? claimList.reduce<Date | null>((min, c) => {
        const t = new Date(c.requestedAt)
        return !min || t < min ? t : min
      }, null)
    : null
  const completedClaims = claimList.filter((c) => c.claimType === 'cancel' || c.claimStatus === 'completed')
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
  const canEditConfirmedItems = order ? EDITABLE_CONFIRMED_ITEM_STATUSES.has(order.status) : false

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
                  {canEditConfirmedItems && (
                  <div className="mb-2 flex justify-end">
                    {editingItems ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingItems(false)
                            setItemDrafts(Object.fromEntries(order.items.map((item) => [
                              item.id,
                              {
                                sku: item.sku ?? '',
                                productName: item.displayName ?? item.productName,
                                optionName: item.displayOptionName ?? item.optionText ?? '',
                                quantity: item.quantity,
                              },
                            ])))
                            setItemSearchTerms({})
                            setItemSearchResults({})
                          }}
                          disabled={savingItems}
                          className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveItemDrafts()}
                          disabled={savingItems}
                          className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {savingItems ? '저장 중...' : '저장'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingItems(true)}
                        className="rounded border px-2 py-1 text-xs hover:bg-muted"
                      >
                        확정정보 수정
                      </button>
                    )}
                  </div>
                  )}
                  <ul className="divide-y text-sm">
                    {order.items.map((item) => {
                      const collectedProductCode = displayCollectedProductCode(order.marketplaceId, item)
                      return (
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
                            {editingItems ? (
                              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_80px]">
                                <div className="relative">
                                  <input
                                    value={itemSearchTerms[item.id] ?? itemDrafts[item.id]?.sku ?? ''}
                                    onChange={(event) => void searchProductsForItem(item.id, event.target.value)}
                                    className="h-8 w-full rounded border px-2 font-mono text-sm"
                                    placeholder="코드/상품명 검색"
                                  />
                                  {(itemSearchResults[item.id]?.length ?? 0) > 0 && (
                                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded border bg-white shadow-lg">
                                      {itemSearchResults[item.id].map((product) => (
                                        <button
                                          key={`${item.id}-${product.internalSku}`}
                                          type="button"
                                          onClick={() => selectProductForItem(item.id, product)}
                                          className="block w-full border-b px-2 py-1.5 text-left text-xs hover:bg-muted last:border-b-0"
                                        >
                                          <span className="block truncate font-mono">{product.internalSku}</span>
                                          <span className="block truncate">{product.name}</span>
                                          <span className="block truncate text-[10px] text-muted-foreground">
                                            {product.optionName ?? product.optionHint ?? '-'} · 재고 {product.availableStock ?? '-'}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <input
                                  value={itemDrafts[item.id]?.productName ?? ''}
                                  onChange={(event) => updateItemDraft(item.id, { productName: event.target.value })}
                                  className="h-8 rounded border px-2 text-sm"
                                  placeholder="확정상품"
                                />
                                <input
                                  value={itemDrafts[item.id]?.optionName ?? ''}
                                  onChange={(event) => updateItemDraft(item.id, { optionName: event.target.value })}
                                  className="h-8 rounded border px-2 text-sm"
                                  placeholder="확정옵션"
                                />
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={itemDrafts[item.id]?.quantity ?? 1}
                                  onChange={(event) => updateItemDraft(item.id, { quantity: Math.max(1, Number(event.target.value) || 1) })}
                                  className="h-8 rounded border px-2 text-sm"
                                  placeholder="수량"
                                />
                              </div>
                            ) : item.displayName ? (
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
                            {!editingItems && (item.displayOptionName ?? item.optionText) && (
                              <span className="text-xs text-muted-foreground">
                                · 옵션: {item.displayOptionName ?? item.optionText}
                              </span>
                            )}
                          </div>
                          {!editingItems && (item.sku || collectedProductCode) && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                              {item.sku && (
                                <span>
                                  내부 상품코드 <span className="font-mono">{item.sku}</span>
                                </span>
                              )}
                              {collectedProductCode && (
                                <span>
                                  수집상품코드 <span className="font-mono">{collectedProductCode}</span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="text-right text-xs">
                          {Number(item.unitPrice).toLocaleString('ko-KR')}원 × {item.quantity}
                        </div>
                      </li>
                    )})}
                  </ul>
                </section>

                {sabangnetRaw && (
                  <section className="rounded-md border p-3">
                    <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                      사방넷 원본 정보
                    </h3>
                    <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">쇼핑몰</dt>
                      <dd>
                        {sabangnetRaw.mallName} {sabangnetRaw.mallAccount ? `(${sabangnetRaw.mallAccount})` : ''}
                      </dd>
                      <dt className="text-muted-foreground">원본 주문상태</dt>
                      <dd>{sabangnetRaw.originalStatus ?? '-'}</dd>
                      <dt className="text-muted-foreground">비고</dt>
                      <dd className="text-muted-foreground">{sabangnetRaw.note ?? '-'}</dd>
                    </dl>
                    <div className="overflow-x-auto rounded border">
                      <table className="min-w-full text-[11px]">
                        <thead className="bg-muted/40">
                          <tr>
                            <th className="whitespace-nowrap px-2 py-1 text-left font-medium">파일</th>
                            <th className="whitespace-nowrap px-2 py-1 text-left font-medium">행</th>
                            <th className="whitespace-nowrap px-2 py-1 text-left font-medium">쇼핑몰 상품코드</th>
                            <th className="whitespace-nowrap px-2 py-1 text-left font-medium">수집 상품명</th>
                            <th className="whitespace-nowrap px-2 py-1 text-left font-medium">수집 옵션</th>
                            <th className="whitespace-nowrap px-2 py-1 text-right font-medium">수량</th>
                            <th className="whitespace-nowrap px-2 py-1 text-left font-medium">사방넷 상품코드</th>
                            <th className="whitespace-nowrap px-2 py-1 text-left font-medium">송장번호</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(sabangnetRaw.rows ?? []).map((row, index) => {
                            const raw = row.raw ?? {}
                            return (
                              <tr key={`${row.sourceFile ?? 'row'}-${row.rowNumber ?? index}`}>
                                <td className="whitespace-nowrap px-2 py-1">{row.sourceFile ?? '-'}</td>
                                <td className="whitespace-nowrap px-2 py-1">{row.rowNumber ?? '-'}</td>
                                <td className="whitespace-nowrap px-2 py-1 font-mono">{raw['쇼핑몰 상품코드'] ?? '-'}</td>
                                <td className="min-w-[200px] px-2 py-1">{raw['수집 상품명'] ?? '-'}</td>
                                <td className="min-w-[120px] px-2 py-1">{raw['수집 옵션'] ?? '-'}</td>
                                <td className="whitespace-nowrap px-2 py-1 text-right">{raw['주문수량'] ?? '-'}</td>
                                <td className="whitespace-nowrap px-2 py-1 font-mono">{raw['사방넷 상품코드'] ?? '-'}</td>
                                <td className="whitespace-nowrap px-2 py-1 font-mono">{raw['송장번호'] ?? '-'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

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

              <section className="rounded-md border lg:col-span-3">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((current) => !current)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-muted/40"
                >
                  <span>변경 이력 ({changeLogList.length}건)</span>
                  <span className="text-sm">{historyOpen ? '⌃' : '⌄'}</span>
                </button>
                {historyOpen && (
                  <div className="border-t p-3">
                    {changeLogList.length === 0 ? (
                      <p className="text-xs text-muted-foreground">변경 이력이 없습니다.</p>
                    ) : (
                      <ul className="space-y-2">
                        {changeLogList.map((log) => (
                          <li key={log.id} className="rounded border bg-gray-50 px-3 py-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-foreground">
                                  {CHANGE_ACTION_LABELS[log.action] ?? log.title}
                                </span>
                                <span className="font-medium">{log.title}</span>
                              </div>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {fmtDateTime(log.createdAt)}
                                {log.actorId && (
                                  <span className="ml-2 font-sans">처리자 {log.actorId.slice(0, 8)}</span>
                                )}
                              </span>
                            </div>
                            {log.description && (
                              <p className="mt-1 text-muted-foreground">{log.description}</p>
                            )}
                            {(log.before || log.after) && (
                              <div className="mt-1 grid gap-1 text-[10px] text-muted-foreground sm:grid-cols-2">
                                {log.before && (
                                  <div className="truncate rounded bg-white px-2 py-1">
                                    이전: {JSON.stringify(log.before)}
                                  </div>
                                )}
                                {log.after && (
                                  <div className="truncate rounded bg-white px-2 py-1">
                                    이후: {JSON.stringify(log.after)}
                                  </div>
                                )}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
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
