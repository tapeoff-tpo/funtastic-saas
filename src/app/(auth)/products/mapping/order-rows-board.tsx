/**
 * OrderRowsBoard — 사방넷 주문서확정관리 스타일 매핑 보드.
 *
 * 레이아웃:
 *   1) 상단 dense 필터 패널 (수집일자 + quick / 쇼핑몰 / 매핑선택 라디오 2그룹 / 검색)
 *   2) 툴바 (자료수 N건 + 일괄 품번/단품매핑 + 매핑해제 + 새로고침)
 *   3) 2그룹 헤더 dense 테이블 (좌: 쇼핑몰 수집 데이터 / 우: 매핑 적용 결과)
 *
 * 매핑 워크플로우 (사방넷 스타일):
 *   - [일괄 품번매핑] / [일괄 단품매핑] = 선택된 행 중 *이미 매핑된* 건들을
 *     매핑완료처리 (POST /api/orders/apply-mappings → orders.mapped_at 기록)
 *   - 미매핑 행의 [+ 품번] / [+ 단품] = 자체상품 검색 모달 오픈 →
 *     선택 시 POST /api/products/mapping-codes 즉시 저장
 */
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryStates, parseAsString, parseAsInteger, parseAsStringEnum } from 'nuqs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageSizeSelector } from '@/components/ui/pagination'
import { RefreshCw, Plus, Search, X } from 'lucide-react'
import { MARKETPLACE_LABELS, marketLabel, type SourceMode } from './mapping-manager'

const EXACT_OPTION_ID = '__exact__'

interface OrderRowComponent {
  sku: string
  quantity: number
  productName: string | null
  optionName: string | null
}

interface OrderRow {
  orderItemId: string
  orderId: string
  marketplaceId: string
  marketplaceOrderId: string
  orderedAt: string
  marketplaceItemId: string
  productName: string
  optionText: string | null
  quantity: number
  mappingStatus: 'both' | 'option' | 'product' | 'unmapped'
  hasProductMapping: boolean
  hasOptionMapping: boolean
  mappingSourceId: string | null
  mappingCodeId: string | null
  mappingCode: string | null
  mappingName: string | null
  components: OrderRowComponent[]
  /** oi.unit_price (decimal as string) */
  unitPrice: string | null
  /** unitPrice * quantity — 서버 계산 */
  totalAmount: string | null
  /** orders.mapped_at — null = 미확정, value = 확정완료 */
  mappedAt: string | null
}

interface OrderRowsResponse {
  rows: OrderRow[]
  total: number
  page: number
  pageSize: number
}

interface ProductSearchResult {
  id: string
  internalSku: string
  name: string
  warehouseLocation: string | null
  basePrice: string | null
  costPrice: string | null
  optionName: string | null
  optionHint: string | null
  availableStock: number | null
}

interface BulkTarget {
  rows: OrderRow[]
  mode: SourceMode
}

interface MappingComponentDraft {
  sku: string
  quantity: number
  productName: string
  optionName: string | null
}

const PRODUCT_MATCH_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'matched', label: '품번매핑' },
  { value: 'unmatched', label: '품번미매핑' },
] as const

const OPTION_MATCH_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'matched', label: '단품매핑' },
  { value: 'unmatched', label: '단품미매핑' },
  { value: 'sku', label: 'SKU매핑' },
] as const

// 선택사항 II — 카테고리 (placeholder, 후속 plan 에서 실제 카테고리 채움)
const CATEGORY_OPTIONS = [
  { value: '', label: '전체 카테고리' },
] as const

// 선택사항 III — 주문상태
const ORDER_STATUS_OPTIONS = [
  { value: '', label: '전체 상태' },
  { value: 'new', label: '신규' },
  { value: 'confirmed', label: '확인' },
  { value: 'preparing', label: '출고준비' },
  { value: 'shipped', label: '배송중' },
  { value: 'delivered', label: '배송완료' },
  { value: 'cancelled', label: '취소' },
] as const

// 선택사항 IV — 기타
const ETC_OPTIONS = [
  { value: '', label: '기타 — 전체' },
  { value: 'has_memo', label: '메모 있음' },
  { value: 'gift', label: '선물주문' },
] as const

function todayKst(): string {
  // 사용자가 한국 시간 기준으로 입력하므로 KST 로 yyyy-mm-dd 생성
  const d = new Date()
  const kstMs = d.getTime() + 9 * 60 * 60 * 1000 - d.getTimezoneOffset() * 60 * 1000
  return new Date(kstMs).toISOString().slice(0, 10)
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function startOfMonth(iso: string): string {
  return iso.slice(0, 7) + '-01'
}

function splitProductOption(itemId: string): { product: string; option: string } {
  const idx = itemId.indexOf('-')
  if (idx <= 0) return { product: itemId, option: '' }
  return { product: itemId.slice(0, idx), option: itemId.slice(idx + 1) }
}

export function OrderRowsBoard() {
  const [filters, setFilters] = useQueryStates({
    from: parseAsString,
    to: parseAsString,
    mkt: parseAsString, // comma separated (선택사항 I — 쇼핑몰)
    category: parseAsString,    // 선택사항 II — 카테고리 (UI plumbing 만, 서버 미적용)
    orderStatus: parseAsString, // 선택사항 III — 주문상태 (UI plumbing 만, 서버 미적용)
    etc: parseAsString,         // 선택사항 IV — 기타 (UI plumbing 만, 서버 미적용)
    productMatch: parseAsStringEnum(['all', 'matched', 'unmatched']).withDefault('all'),
    optionMatch: parseAsStringEnum(['all', 'matched', 'unmatched', 'sku']).withDefault('all'),
    q: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(25),
    /** 0 = 미검색(안내문구만 노출, fetch 차단). 1 = 검색됨(자동 reload). */
    searched: parseAsInteger.withDefault(0),
  }, { shallow: false })

  const [searchInput, setSearchInput] = useState(filters.q ?? '')
  useEffect(() => { setSearchInput(filters.q ?? '') }, [filters.q])

  const selectedMarkets = useMemo(
    () => (filters.mkt ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    [filters.mkt],
  )
  const marketplaceFilterOptions = useMemo(
    () => Object.entries(MARKETPLACE_LABELS)
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko-KR')),
    [],
  )

  const [rows, setRows] = useState<OrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkTarget, setBulkTarget] = useState<BulkTarget | null>(null)
  const [applying, setApplying] = useState(false)

  const pageSize = filters.pageSize

  const reload = useCallback(async () => {
    // sentinel: 검색 버튼을 누르기 전에는 fetch 자체를 실행하지 않음.
    // /orders 페이지의 tab-sentinel 패턴과 일치 — 진입 시 안내문구만 보이고
    // 네트워크 요청 0회 보장.
    if (filters.searched !== 1) {
      setRows([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (selectedMarkets.length > 0) params.set('marketplaceIds', selectedMarkets.join(','))
      if (filters.productMatch !== 'all') params.set('productMatch', filters.productMatch)
      if (filters.optionMatch !== 'all') params.set('optionMatch', filters.optionMatch)
      if (filters.q) params.set('q', filters.q)
      // category / orderStatus / etc 는 이번 plan 에서 서버 필터 미적용 — UI plumbing 만 노출.
      // 후속 plan 에서 API 확장 시 여기에 params.set 추가.
      params.set('page', String(filters.page))
      params.set('pageSize', String(pageSize))

      const res = await fetch(`/api/products/mapping-codes/order-rows?${params.toString()}`)
      if (!res.ok) {
        setRows([])
        setTotal(0)
        return
      }
      const data: OrderRowsResponse = await res.json()
      setRows(data.rows)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }, [filters.searched, filters.from, filters.to, filters.productMatch, filters.optionMatch, filters.q, filters.page, selectedMarkets, pageSize])

  useEffect(() => { void reload() }, [reload])

  // ---------- 필터 핸들러 ----------
  const setQuickRange = (range: 'today' | 'week' | 'month' | '1month') => {
    const today = todayKst()
    let from: string, to: string
    switch (range) {
      case 'today':
        from = today; to = today; break
      case 'week':
        from = shiftDays(today, -6); to = today; break
      case 'month':
        from = startOfMonth(today); to = today; break
      case '1month':
        from = shiftDays(today, -29); to = today; break
    }
    void setFilters({ from, to, page: 1 })
  }

  const submitSearch = () => {
    // 조회 버튼 클릭 → searched=1 sentinel 세팅. 이 이후로 reload 가 실제 fetch 수행.
    void setFilters({ q: searchInput.trim() || null, page: 1, searched: 1 })
  }

  const resetFilters = () => {
    setSearchInput('')
    // 초기화 → searched=0 으로 되돌려서 다시 안내문구 화면으로 (fetch 차단).
    void setFilters({
      from: null, to: null, mkt: null,
      category: null, orderStatus: null, etc: null,
      productMatch: 'all', optionMatch: 'all',
      q: null, page: 1, searched: 0,
    })
  }

  // ---------- 행 선택 ----------
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.orderItemId))
  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(rows.map((r) => r.orderItemId)))
  }
  const toggleRow = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  // ---------- 미매핑 행 → 자체상품 검색 모달 ----------
  // 행의 [+ 품번] / [+ 단품] 버튼 클릭 시 호출. BulkMappingPanel 이 모달로 열림.
  function openMapping(row: OrderRow, mode: SourceMode) {
    setBulkTarget({ rows: [row], mode })
  }

  // ---------- 일괄 매핑완료처리 ----------
  // [일괄 품번/단품매핑] 버튼: 선택된 행 중 *이미 매핑된* 건의 주문을 매핑완료로 마크.
  // 미매핑 행은 무시 (행별 [+ 품번]/[+ 단품] 으로 처리해야 함).
  // mode 는 표시용 — 매핑완료 처리는 mode 와 무관하게 mapped_at 만 기록.
  async function applyBulkMapped(mode: SourceMode) {
    const selectedRows = rows.filter((r) => selected.has(r.orderItemId))
    if (selectedRows.length === 0) {
      alert('선택된 행이 없습니다')
      return
    }
    const modeLabel = mode === 'product' ? '품번매핑' : '단품매핑'
    // 'both' 행은 양쪽 모두 매핑된 상태이므로 어느 일괄버튼이든 매핑완료 대상에 포함.
    const mapped = selectedRows.filter((r) =>
      mode === 'product'
        ? r.hasProductMapping
        : r.hasOptionMapping,
    )
    const skipped = selectedRows.length - mapped.length
    if (mapped.length === 0) {
      alert(`선택된 행 중 ${modeLabel} 상태인 행이 없습니다`)
      return
    }
    const orderIds = Array.from(new Set(mapped.map((r) => r.orderId)))

    setApplying(true)
    try {
      const res = await fetch('/api/orders/apply-mappings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? '매핑완료 처리 실패')
        return
      }
      const data = await res.json() as { applied: number }
      const skipNote = skipped > 0 ? ` (미매핑/타입불일치 ${skipped}건 제외)` : ''
      alert(`${modeLabel} ${data.applied}건 매핑완료 처리됨${skipNote}`)
      setSelected(new Set())
      await reload()
    } finally {
      setApplying(false)
    }
  }

  // ---------- 일괄주문확정 — 선택된 행의 unique orderId 전체에 대해 mode 무관하게 매핑확정 ----------
  async function applyBulkOrderConfirm() {
    const selRows = rows.filter((r) => selected.has(r.orderItemId))
    if (selRows.length === 0) {
      alert('선택된 행이 없습니다')
      return
    }
    const orderIds = Array.from(new Set(selRows.map((r) => r.orderId)))
    if (!confirm(`선택된 ${orderIds.length}건의 주문을 매핑확정 처리합니다. 진행할까요?`)) return

    setApplying(true)
    try {
      const res = await fetch('/api/orders/apply-mappings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? '주문확정 실패')
        return
      }
      const data = await res.json() as { applied: number }
      alert(`주문확정 ${data.applied}건 처리됨`)
      setSelected(new Set())
      await reload()
    } finally {
      setApplying(false)
    }
  }

  // ---------- 다운로드 (plumbing only — 후속 plan) ----------
  function handleDownload() {
    alert('다운로드 기능은 후속 plan 에서 구현됩니다 (현재 필터+선택행 기준 Excel export 예정)')
  }

  // ---------- 선택삭제 (plumbing only — 후속 plan) ----------
  function handleSelectDelete() {
    if (selected.size === 0) return
    alert(`선택삭제는 후속 plan 에서 구현됩니다 (선택 ${selected.size}건)`)
  }

  function openUnmap() {
    const targets = rows.filter((r) => selected.has(r.orderItemId) && r.mappingCodeId)
    if (targets.length === 0) {
      alert('선택된 행 중 매핑된 행이 없습니다')
      return
    }
    alert(
      '일괄 매핑해제는 별도 API 가 없어 현재 매핑코드 마스터에서 처리합니다. ' +
      '매핑코드 마스터(/products/mapping-codes) 에서 해당 매핑코드를 열고 마켓상품 행을 제거하세요.',
    )
  }

  // ---------- 인라인 패널 → 자체상품 선택 시 즉시 매핑 저장 ----------
  async function submitBulkMapping(components: MappingComponentDraft[]): Promise<void> {
    if (!bulkTarget) return
    const validComponents = components.filter((c) => c.sku.trim() && c.quantity > 0)
    if (validComponents.length === 0) {
      alert('재고관리코드를 1개 이상 선택하세요')
      return
    }
    const sources = bulkTarget.rows.map((r) => {
      const split = splitProductOption(r.marketplaceItemId)
      return {
        marketplaceId: r.marketplaceId,
        marketplaceProductId: split.product,
        marketplaceOptionId: bulkTarget.mode === 'option' ? (split.option || EXACT_OPTION_ID) : '',
        productNameSnapshot: r.productName || null,
        optionNameSnapshot: r.optionText || null,
      }
    })
    const firstRow = bulkTarget.rows[0]
    const firstComponent = validComponents[0]
    const firstSource = sources[0]
    const sourceKey = firstSource
      ? `${firstSource.marketplaceId}-${firstSource.marketplaceProductId}${firstSource.marketplaceOptionId ? `-${firstSource.marketplaceOptionId}` : ''}`
      : 'manual'
    const code = `${firstComponent.sku}-${sourceKey}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100)
    const setLabel = validComponents.length > 1
      ? ` 외 ${validComponents.length - 1}개`
      : firstComponent.quantity > 1
        ? ` x${firstComponent.quantity}`
        : ''
    const res = await fetch('/api/products/mapping-codes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        name: firstRow?.productName || `${firstComponent.productName}${setLabel}`,
        note: null,
        isActive: true,
        sources,
        components: validComponents.map((component) => ({
          sku: component.sku,
          quantity: component.quantity,
        })),
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      alert(err.error ?? '매핑 저장 실패')
      return
    }
    setBulkTarget(null)
    setSelected(new Set())
    await reload()
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-2">
      {/* ============ 상단 dense 필터 패널 ============ */}
      <div className="rounded-md border bg-muted/20 p-2 text-xs">
        {/* Row 1 — 수집일자 + quick */}
        <div className="flex flex-wrap items-center gap-2 border-b pb-1.5">
          <span className="w-16 shrink-0 text-muted-foreground">수집일자</span>
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => setFilters({ from: e.target.value || null, page: 1 })}
            className="rounded border px-1.5 py-0.5"
          />
          <span className="text-muted-foreground">~</span>
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => setFilters({ to: e.target.value || null, page: 1 })}
            className="rounded border px-1.5 py-0.5"
          />
          <div className="flex gap-1">
            <button type="button" onClick={() => setQuickRange('today')} className="rounded border px-1.5 py-0.5 hover:bg-muted">오늘</button>
            <button type="button" onClick={() => setQuickRange('week')} className="rounded border px-1.5 py-0.5 hover:bg-muted">1주일</button>
            <button type="button" onClick={() => setQuickRange('month')} className="rounded border px-1.5 py-0.5 hover:bg-muted">당월</button>
            <button type="button" onClick={() => setQuickRange('1month')} className="rounded border px-1.5 py-0.5 hover:bg-muted">1개월</button>
          </div>
        </div>

        {/* Row 2 — 쇼핑몰 칩 */}
        <div className="flex flex-wrap items-center gap-1.5 border-b py-1.5">
          <span className="w-16 shrink-0 text-muted-foreground">쇼핑몰</span>
          <select
            value={selectedMarkets[0] ?? ''}
            onChange={(e) => setFilters({ mkt: e.target.value || null, page: 1 })}
            className="min-w-[180px] rounded border bg-background px-2 py-0.5 text-xs"
          >
            <option value="">전체 쇼핑몰</option>
            {marketplaceFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {selectedMarkets.length > 0 && (
            <button
              type="button"
              onClick={() => setFilters({ mkt: null, page: 1 })}
              className="ml-1 text-[10px] text-muted-foreground hover:underline"
            >
              초기화
            </button>
          )}
        </div>

        {/* Row 2.5 — 선택사항 II / III / IV (카테고리 / 주문상태 / 기타) */}
        <div className="flex flex-wrap items-center gap-2 border-b py-1.5">
          <span className="w-16 shrink-0 text-muted-foreground">선택사항</span>
          <select
            value={filters.category ?? ''}
            onChange={(e) => setFilters({ category: e.target.value || null, page: 1 })}
            className="rounded border bg-background px-2 py-0.5 text-xs"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={filters.orderStatus ?? ''}
            onChange={(e) => setFilters({ orderStatus: e.target.value || null, page: 1 })}
            className="rounded border bg-background px-2 py-0.5 text-xs"
          >
            {ORDER_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={filters.etc ?? ''}
            onChange={(e) => setFilters({ etc: e.target.value || null, page: 1 })}
            className="rounded border bg-background px-2 py-0.5 text-xs"
          >
            {ETC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Row 3 — 매핑선택 라디오 (1줄: 품번매핑 그룹) */}
        <div className="flex flex-wrap items-center gap-2 border-b py-1">
          <span className="w-16 shrink-0 text-muted-foreground">매핑선택</span>
          {PRODUCT_MATCH_OPTIONS.map((opt) => (
            <label key={opt.value} className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="productMatch"
                checked={filters.productMatch === opt.value}
                onChange={() => setFilters({ productMatch: opt.value, page: 1 })}
              />
              {opt.label}
            </label>
          ))}
        </div>

        {/* Row 3.5 — 매핑선택 라디오 (2줄: 단품매핑 그룹) */}
        <div className="flex flex-wrap items-center gap-2 border-b py-1">
          <span className="w-16 shrink-0 text-muted-foreground"></span>
          {OPTION_MATCH_OPTIONS.map((opt) => (
            <label key={opt.value} className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="optionMatch"
                checked={filters.optionMatch === opt.value}
                onChange={() => setFilters({ optionMatch: opt.value, page: 1 })}
              />
              {opt.label}
            </label>
          ))}
        </div>

        {/* Row 4 — 검색 */}
        <form
          onSubmit={(e) => { e.preventDefault(); submitSearch() }}
          className="flex flex-wrap items-center gap-2 pt-1.5"
        >
          <span className="w-16 shrink-0 text-muted-foreground">검색항목</span>
          <select disabled className="rounded border bg-background px-2 py-0.5 text-xs text-muted-foreground">
            <option>쇼핑몰상품코드/상품명/옵션</option>
          </select>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="검색어 입력"
            className="flex-1 min-w-[200px] rounded border px-2 py-0.5"
          />
          <button type="submit" className="inline-flex items-center gap-1 rounded border bg-background px-2 py-0.5 hover:bg-muted">
            <Search className="size-3" /> 조회
          </button>
          <button type="button" onClick={resetFilters} className="rounded border bg-background px-2 py-0.5 hover:bg-muted">
            초기화
          </button>
        </form>
      </div>

      {/* ============ 툴바 ============ */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div>
          자료수 <strong className="tabular-nums">{total.toLocaleString()}</strong>건
          {selected.size > 0 && (
            <span className="ml-2 text-muted-foreground">
              (선택 <strong className="tabular-nums">{selected.size}</strong>건)
            </span>
          )}
        </div>
        <PageSizeSelector
          pageSize={pageSize}
          total={total}
          pageSizeOptions={[25, 50, 100, 200, 500, 1000]}
          onPageSizeChange={(s) => setFilters({ pageSize: s })}
          onPageChange={(p) => setFilters({ page: p })}
          className="text-xs [&>select]:py-0.5 [&>select]:text-xs"
        />
        <div className="ml-auto flex gap-1.5">
          <Button
            onClick={() => void applyBulkMapped('product')}
            disabled={applying}
            size="sm" variant="outline" className="h-7 px-2 text-xs"
          >
            <Plus className="size-3" /> 일괄 품번매핑
          </Button>
          <Button
            onClick={() => void applyBulkMapped('option')}
            disabled={applying}
            size="sm" variant="outline" className="h-7 px-2 text-xs"
          >
            <Plus className="size-3" /> 일괄 단품매핑
          </Button>
          <Button
            onClick={() => void applyBulkOrderConfirm()}
            disabled={applying}
            size="sm" variant="outline" className="h-7 px-2 text-xs"
          >
            일괄주문확정
          </Button>
          <Button onClick={handleDownload} size="sm" variant="outline" className="h-7 px-2 text-xs">
            다운로드
          </Button>
          <Button
            onClick={handleSelectDelete}
            disabled={selected.size === 0}
            size="sm" variant="outline" className="h-7 px-2 text-xs"
          >
            선택삭제
          </Button>
          <Button onClick={openUnmap} size="sm" variant="outline" className="h-7 px-2 text-xs">
            매핑해제
          </Button>
          <Button onClick={() => void reload()} size="sm" variant="outline" className="h-7 px-2 text-xs">
            <RefreshCw className="size-3" /> 새로고침
          </Button>
        </div>
      </div>

      {/* ============ 2그룹 헤더 dense 테이블 (또는 안내문구) ============ */}
      {filters.searched !== 1 ? (
        <div className="rounded-md border bg-muted/30 px-6 py-12 text-center text-sm text-muted-foreground">
          상단 필터 설정 후 [조회] 버튼을 눌러 매핑관리 데이터를 불러오세요.
        </div>
      ) : (
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th rowSpan={2} className="w-8 border-b px-1 py-1">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th colSpan={7} className="border-b border-r bg-blue-50/50 px-2 py-1 text-center font-medium">
                쇼핑몰 수집 데이터
              </th>
              <th colSpan={5} className="border-b bg-emerald-50/50 px-2 py-1 text-center font-medium">
                매핑 적용 결과
              </th>
            </tr>
            <tr className="text-[11px]">
              <th className="border-b px-1.5 py-1 text-left font-medium">쇼핑몰</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">쇼핑몰주문번호</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">쇼핑몰상품코드</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">상품명/옵션</th>
              <th className="border-b px-1.5 py-1 text-right font-medium">수량</th>
              <th className="border-b px-1.5 py-1 text-right font-medium">주문금액</th>
              <th className="border-b border-r px-1.5 py-1 text-center font-medium">매핑여부</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">품번-단품</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">SKU</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">상품명/옵션(재고)</th>
              <th className="border-b px-1.5 py-1 text-right font-medium">수량</th>
              <th className="border-b px-1.5 py-1 text-center font-medium">확정여부</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={13} className="py-6 text-center text-muted-foreground">불러오는 중...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={13} className="py-6 text-center text-muted-foreground">조회 결과가 없습니다</td></tr>
            ) : rows.map((r) => {
              const split = splitProductOption(r.marketplaceItemId)
              const canAddProductMapping = !r.hasProductMapping
              const canAddOptionMapping = !r.hasOptionMapping
              const compsOrEmpty: (OrderRowComponent | null)[] = r.components.length > 0
                ? r.components
                : [null]
              return compsOrEmpty.map((comp, ci) => (
                <tr key={`${r.orderItemId}-${ci}`} className="hover:bg-muted/30">
                  {ci === 0 && (
                    <td rowSpan={compsOrEmpty.length} className="px-1 py-1 align-top">
                      <input
                        type="checkbox"
                        checked={selected.has(r.orderItemId)}
                        onChange={() => toggleRow(r.orderItemId)}
                      />
                    </td>
                  )}
                  {ci === 0 && (
                    <>
                      <td rowSpan={compsOrEmpty.length} className="px-1.5 py-1 align-top">
                        <span className="inline-block rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium">
                          {marketLabel(r.marketplaceId)}
                        </span>
                      </td>
                      <td rowSpan={compsOrEmpty.length} className="px-1.5 py-1 align-top font-mono text-[11px]">
                        {r.marketplaceOrderId}
                      </td>
                      <td rowSpan={compsOrEmpty.length} className="px-1.5 py-1 align-top font-mono text-[11px]">
                        {r.marketplaceItemId}
                      </td>
                      <td rowSpan={compsOrEmpty.length} className="max-w-[260px] px-1.5 py-1 align-top">
                        <div className="truncate">{r.productName}</div>
                        {r.optionText && (
                          <div className="truncate text-[10px] text-muted-foreground">{r.optionText}</div>
                        )}
                      </td>
                      <td rowSpan={compsOrEmpty.length} className="px-1.5 py-1 text-right align-top tabular-nums">
                        {r.quantity}
                      </td>
                      <td rowSpan={compsOrEmpty.length} className="px-1.5 py-1 text-right align-top tabular-nums">
                        {r.totalAmount != null ? Number(r.totalAmount).toLocaleString('ko-KR') : '-'}
                      </td>
                      <td rowSpan={compsOrEmpty.length} className="border-r px-1.5 py-1 align-top">
                        <div className="space-y-1">
                          {r.mappingStatus === 'both' ? (
                            <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100">매핑완료</Badge>
                          ) : r.mappingStatus === 'option' ? (
                            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">단품매핑</Badge>
                          ) : r.mappingStatus === 'product' ? (
                            <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">품번매핑</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">미매핑</Badge>
                          )}
                          {(canAddProductMapping || canAddOptionMapping) && (
                            <div className="flex flex-wrap gap-1">
                              {canAddProductMapping && (
                                <button
                                  type="button"
                                  onClick={() => openMapping(r, 'product')}
                                  className="rounded border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted"
                                  title={`품번 ${split.product} 으로 매핑`}
                                >
                                  + 품번
                                </button>
                              )}
                              {canAddOptionMapping && (
                                <button
                                  type="button"
                                  onClick={() => openMapping(r, 'option')}
                                  className="rounded border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted"
                                  title={`단품 ${r.marketplaceItemId} 만 매핑`}
                                >
                                  + 단품
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                  {comp ? (
                    <>
                      <td className="px-1.5 py-1 font-mono text-[11px]">
                        {r.mappingCode ?? '-'}
                      </td>
                      <td className="px-1.5 py-1 font-mono text-[11px]">{comp.sku}</td>
                      <td className="max-w-[220px] px-1.5 py-1">
                        <div className="truncate">{comp.productName ?? <span className="text-muted-foreground">(재고 미등록)</span>}</div>
                        {comp.optionName && (
                          <div className="truncate text-[10px] text-muted-foreground">{comp.optionName}</div>
                        )}
                      </td>
                      <td className="px-1.5 py-1 text-right tabular-nums">
                        {r.quantity * comp.quantity}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-1.5 py-1 text-muted-foreground">—</td>
                  )}
                  {/* 확정여부 — 행(orderItem) 단위. 첫 component row 에 rowSpan 으로 한 번만. */}
                  {ci === 0 && (
                    <td rowSpan={compsOrEmpty.length} className="px-1.5 py-1 text-center align-top">
                      {r.mappedAt ? (
                        <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100">확정완료</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">미확정</Badge>
                      )}
                    </td>
                  )}
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* ============ 페이지네이션 ============ */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={() => setFilters({ page: Math.max(1, filters.page - 1) })}
            disabled={filters.page <= 1}
            className="rounded border bg-background px-2 py-0.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            이전
          </button>
          <span className="tabular-nums">
            {filters.page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setFilters({ page: Math.min(totalPages, filters.page + 1) })}
            disabled={filters.page >= totalPages}
            className="rounded border bg-background px-2 py-0.5 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {/* ============ 자체상품 검색 모달 (행의 [+ 품번]/[+ 단품] 클릭 시) ============ */}
      {bulkTarget && (
        <BulkMappingModal
          target={bulkTarget}
          onClose={() => setBulkTarget(null)}
          onSave={submitBulkMapping}
        />
      )}
    </div>
  )
}

/**
 * 자체상품 검색 모달 — 미매핑 행의 [+ 품번] / [+ 단품] 클릭 시 새창(모달)으로 등장.
 * - 좌: 선택된 행 요약 (쇼핑몰 / 상품명 / 옵션 / 수량)
 * - 우: 자체상품 검색 폼 + 결과 테이블
 * - 결과 [선택] 클릭 시 onSelect(product) → 즉시 POST /api/products/mapping-codes 저장
 */
function BulkMappingModal({
  target,
  onClose,
  onSave,
}: {
  target: BulkTarget
  onClose: () => void
  onSave: (components: MappingComponentDraft[]) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [components, setComponents] = useState<MappingComponentDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 패널 열릴 때 검색 input 자동 포커스
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    try {
      // 품번매핑 모드면 SKU prefix 단위로 그룹화된 결과를 받아온다.
      // 단품 행을 잘못 골라서 mapping_code 가 단품 단위로 만들어지는 사고 방지.
      const res = await fetch(
        `/api/products/search?q=${encodeURIComponent(q)}&mode=${target.mode}`,
      )
      if (!res.ok) {
        setResults([])
        return
      }
      const data = await res.json() as { results: ProductSearchResult[] }
      setResults(data.results ?? [])
      setSearched(true)
    } finally {
      setLoading(false)
    }
  }, [target.mode])

  const handleQueryChange = (v: string) => {
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void search(v), 300)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    void search(query)
  }

  const addComponent = (p: ProductSearchResult) => {
    setComponents((prev) => {
      const existingIdx = prev.findIndex((component) => component.sku === p.internalSku)
      if (existingIdx >= 0) {
        return prev.map((component, idx) => (
          idx === existingIdx
            ? { ...component, quantity: component.quantity + 1 }
            : component
        ))
      }
      return [
        ...prev,
        {
          sku: p.internalSku,
          quantity: 1,
          productName: p.name,
          optionName: p.optionHint ?? p.optionName ?? null,
        },
      ]
    })
  }

  const updateComponentQuantity = (idx: number, quantity: number) => {
    setComponents((prev) => prev.map((component, componentIdx) => (
      componentIdx === idx
        ? { ...component, quantity: Math.max(1, quantity || 1) }
        : component
    )))
  }

  const removeComponent = (idx: number) => {
    setComponents((prev) => prev.filter((_, componentIdx) => componentIdx !== idx))
  }

  const handleSave = async () => {
    if (components.length === 0) {
      alert('재고관리코드를 1개 이상 선택하세요')
      return
    }
    setSubmitting(true)
    try {
      await onSave(components)
    } finally {
      setSubmitting(false)
    }
  }

  const fmtPrice = (v: string | null) =>
    v == null ? '-' : Number(v).toLocaleString('ko-KR')

  const modeLabel = target.mode === 'product' ? '품번매핑' : '단품매핑'
  const modeColor = target.mode === 'product'
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : 'bg-emerald-100 text-emerald-800 border-emerald-200'

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 — 모드 + 선택 건수 + 닫기 */}
        <div className="flex items-center justify-between border-b bg-blue-50/60 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className={`rounded border px-2 py-0.5 text-xs font-medium ${modeColor}`}>
              {modeLabel}
            </span>
            <span className="font-medium">재고관리코드로 매핑 적용</span>
            <span className="text-muted-foreground">
              (선택된 마켓상품 <strong className="tabular-nums">{target.rows.length}</strong>건)
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[300px_1fr]">
        {/* 선택된 행 요약 */}
        <div className="rounded border bg-background">
          <div className="border-b bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
            선택된 마켓상품 ({target.rows.length}건)
          </div>
          <div className="max-h-64 overflow-auto divide-y text-xs">
            {target.rows.map((r) => {
              const split = splitProductOption(r.marketplaceItemId)
              const showOption = target.mode === 'option' && split.option
              return (
                <div key={r.orderItemId} className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">
                      {marketLabel(r.marketplaceId)}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {showOption
                        ? `${split.product}-${split.option}`
                        : split.product}
                    </span>
                  </div>
                  <div className="truncate">{r.productName}</div>
                  {r.optionText && (
                    <div className="truncate text-[10px] text-muted-foreground">
                      {r.optionText}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 검색 폼 + 결과 */}
        <div className="rounded border bg-background">
          <form onSubmit={handleSubmit} className="border-b bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">검색항목</label>
              <select
                disabled
                className="rounded border bg-background px-2 py-1 text-xs text-muted-foreground"
              >
                <option>품번/상품명</option>
              </select>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="재고관리코드 또는 상품명 검색"
                disabled={submitting}
                className="flex-1 rounded border bg-background px-2 py-1 text-sm"
              />
              <Button type="submit" size="sm" disabled={loading || submitting}>
                <Search className="size-3.5" />
                {loading ? '검색 중...' : '검색'}
              </Button>
            </div>
          </form>

          <div className="border-b bg-amber-50/60 px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-900">매핑할 재고 구성</span>
              <span className="text-[11px] text-amber-800">
                4ea는 수량 4, 세트는 SKU를 여러 개 추가
              </span>
            </div>
            {components.length === 0 ? (
              <div className="rounded border border-dashed border-amber-200 bg-white/60 px-3 py-2 text-xs text-amber-800">
                아래 검색 결과에서 재고관리코드를 선택하세요.
              </div>
            ) : (
              <div className="space-y-1">
                {components.map((component, idx) => (
                  <div key={`${component.sku}-${idx}`} className="grid grid-cols-[1fr_72px_24px] items-center gap-2 rounded border bg-white px-2 py-1">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs">{component.sku}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {component.productName}
                        {component.optionName ? ` · ${component.optionName}` : ''}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={component.quantity}
                      onChange={(e) => updateComponentQuantity(idx, parseInt(e.target.value, 10))}
                      disabled={submitting}
                      className="rounded border px-1.5 py-1 text-right text-xs tabular-nums"
                      aria-label={`${component.sku} 구성 수량`}
                    />
                    <button
                      type="button"
                      onClick={() => removeComponent(idx)}
                      disabled={submitting}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                      aria-label="구성품 제거"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[1] bg-muted/60">
                <tr className="border-b">
                  <th className="w-10 px-2 py-1.5 text-center font-medium">No</th>
                  <th className="px-2 py-1.5 text-left font-medium">재고관리코드</th>
                  <th className="px-2 py-1.5 text-left font-medium">상품명 / 옵션</th>
                  <th className="px-2 py-1.5 text-right font-medium">판매가</th>
                  <th className="px-2 py-1.5 text-right font-medium">원가 / 이익률</th>
                  <th className="px-2 py-1.5 text-right font-medium">재고</th>
                  <th className="w-20 px-2 py-1.5 text-center font-medium">추가</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      불러오는 중...
                    </td>
                  </tr>
                ) : !searched ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    재고관리코드 또는 상품명을 입력하고 검색하세요
                    </td>
                  </tr>
                ) : results.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      검색 결과가 없습니다
                    </td>
                  </tr>
                ) : (
                  results.map((p, idx) => {
                    const base = p.basePrice ? Number(p.basePrice) : null
                    const cost = p.costPrice ? Number(p.costPrice) : null
                    const margin = base != null && cost != null && base > 0
                      ? Math.round(((base - cost) / base) * 1000) / 10
                      : null
                    return (
                      <tr key={p.id} className="hover:bg-muted/40">
                        <td className="px-2 py-1.5 text-center text-muted-foreground tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="px-2 py-1.5 font-mono">{p.internalSku}</td>
                        <td className="px-2 py-1.5">
                          <div className="truncate">{p.name}</div>
                          {p.optionHint && (
                            <div className="truncate text-[10px] text-muted-foreground">
                              {p.optionHint}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtPrice(p.basePrice)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          <div>{fmtPrice(p.costPrice)}</div>
                          {margin != null && (
                            <div className="text-[10px] text-muted-foreground">{margin}%</div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {p.availableStock ?? '-'}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => addComponent(p)}
                            disabled={submitting}
                            className="rounded border bg-background px-2 py-0.5 text-[11px] hover:bg-blue-50 hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            추가
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>

        <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-3">
          <div className="text-xs text-muted-foreground">
            주문 수량에 구성 수량이 곱해져 재고/출고 수량으로 전개됩니다.
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              취소
            </Button>
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={submitting || components.length === 0}>
              {submitting ? '저장 중...' : `매핑 저장 (${components.length})`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
