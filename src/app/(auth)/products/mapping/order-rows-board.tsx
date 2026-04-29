/**
 * OrderRowsBoard — 사방넷 주문서확정관리 스타일 매핑 보드.
 *
 * 레이아웃:
 *   1) 상단 dense 필터 패널 (수집일자 + quick / 쇼핑몰 / 매핑선택 라디오 2그룹 / 검색)
 *   2) 툴바 (자료수 N건 + 일괄 품번/단품매핑 + 매핑해제 + 새로고침)
 *   3) 2그룹 헤더 dense 테이블 (좌: 쇼핑몰 수집 데이터 / 우: 매핑 적용 결과)
 *
 * 행 = order_items 1건. 미매핑 행은 [+ 품번매핑] / [+ 단품매핑] 버튼 클릭으로
 * EditDialog 가 prefill 상태로 열리고 저장 후 즉시 보드 재조회.
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryStates, parseAsString, parseAsInteger, parseAsStringEnum } from 'nuqs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageSizeSelector } from '@/components/ui/pagination'
import { RefreshCw, Plus, Search } from 'lucide-react'
import {
  EditDialog,
  emptyForm,
  MARKETPLACE_LABELS,
  marketLabel,
  type FormState,
  type SourceMode,
} from './mapping-manager'

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
  mappingStatus: 'option' | 'product' | 'unmapped'
  mappingSourceId: string | null
  mappingCodeId: string | null
  mappingCode: string | null
  mappingName: string | null
  components: OrderRowComponent[]
}

interface OrderRowsResponse {
  rows: OrderRow[]
  total: number
  page: number
  pageSize: number
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
    mkt: parseAsString, // comma separated
    productMatch: parseAsStringEnum(['all', 'matched', 'unmatched']).withDefault('all'),
    optionMatch: parseAsStringEnum(['all', 'matched', 'unmatched', 'sku']).withDefault('all'),
    q: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(50),
  }, { shallow: false })

  const [searchInput, setSearchInput] = useState(filters.q ?? '')
  useEffect(() => { setSearchInput(filters.q ?? '') }, [filters.q])

  const selectedMarkets = useMemo(
    () => (filters.mkt ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    [filters.mkt],
  )

  const [rows, setRows] = useState<OrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  const pageSize = filters.pageSize

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (selectedMarkets.length > 0) params.set('marketplaceIds', selectedMarkets.join(','))
      if (filters.productMatch !== 'all') params.set('productMatch', filters.productMatch)
      if (filters.optionMatch !== 'all') params.set('optionMatch', filters.optionMatch)
      if (filters.q) params.set('q', filters.q)
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
  }, [filters.from, filters.to, filters.productMatch, filters.optionMatch, filters.q, filters.page, filters.pageSize, selectedMarkets, pageSize])

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

  const toggleMarket = (id: string) => {
    const next = new Set(selectedMarkets)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    void setFilters({ mkt: next.size > 0 ? Array.from(next).join(',') : null, page: 1 })
  }

  const submitSearch = () => {
    void setFilters({ q: searchInput.trim() || null, page: 1 })
  }

  const resetFilters = () => {
    setSearchInput('')
    void setFilters({
      from: null, to: null, mkt: null,
      productMatch: 'all', optionMatch: 'all',
      q: null, page: 1,
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

  // ---------- 매핑 다이얼로그 prefill ----------
  function buildPrefillForm(targets: OrderRow[], mode: SourceMode): FormState {
    const form = emptyForm()
    if (targets.length === 0) return form
    const head = targets[0]
    form.name = head.productName
    form.sources = targets.map((r) => {
      const split = splitProductOption(r.marketplaceItemId)
      return {
        mode,
        marketplaceId: r.marketplaceId,
        marketplaceProductId: split.product,
        marketplaceOptionId: mode === 'option' ? split.option : '',
        productNameSnapshot: r.productName,
        optionNameSnapshot: r.optionText ?? '',
      }
    })
    return form
  }

  function openMapping(row: OrderRow, mode: SourceMode) {
    setEditing(buildPrefillForm([row], mode))
  }

  function openBulk(mode: SourceMode) {
    const targets = rows.filter((r) => selected.has(r.orderItemId))
    if (targets.length === 0) {
      alert('선택된 행이 없습니다')
      return
    }
    setEditing(buildPrefillForm(targets, mode))
  }

  function openUnmap() {
    const targets = rows.filter((r) => selected.has(r.orderItemId) && r.mappingCodeId)
    if (targets.length === 0) {
      alert('선택된 행 중 매핑된 행이 없습니다')
      return
    }
    alert(
      '일괄 매핑해제는 별도 API 가 없어 현재 다이얼로그 편집으로 대체합니다. ' +
      '매핑코드 마스터(/products/mapping-codes) 에서 해당 매핑코드를 열고 마켓상품 행을 제거하세요.',
    )
  }

  // ---------- 저장 ----------
  async function handleSave() {
    if (!editing) return
    if (!editing.code.trim() || !editing.name.trim()) {
      alert('매핑코드와 이름을 입력하세요')
      return
    }
    if (editing.components.length === 0 || editing.components.some((c) => !c.sku.trim())) {
      alert('SKU 구성품을 1개 이상 입력하세요')
      return
    }

    setSaving(true)
    try {
      const url = editing.id
        ? `/api/products/mapping-codes/${editing.id}`
        : '/api/products/mapping-codes'
      const method = editing.id ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: editing.code.trim(),
          name: editing.name.trim(),
          note: editing.note.trim() || null,
          isActive: editing.isActive,
          sources: editing.sources
            .filter((s) => s.marketplaceId && s.marketplaceProductId)
            .map((s) => ({
              marketplaceId: s.marketplaceId,
              marketplaceProductId: s.marketplaceProductId.trim(),
              marketplaceOptionId: s.mode === 'option' ? s.marketplaceOptionId.trim() : '',
              productNameSnapshot: s.productNameSnapshot.trim() || null,
              optionNameSnapshot: s.optionNameSnapshot.trim() || null,
            })),
          components: editing.components
            .filter((c) => c.sku.trim())
            .map((c) => ({ sku: c.sku.trim(), quantity: c.quantity })),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? '저장 실패')
        return
      }
      setEditing(null)
      setSelected(new Set())
      await reload()
    } finally {
      setSaving(false)
    }
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
          {Object.entries(MARKETPLACE_LABELS).map(([id, label]) => {
            const on = selectedMarkets.includes(id)
            return (
              <button
                type="button"
                key={id}
                onClick={() => toggleMarket(id)}
                className={`rounded border px-1.5 py-0.5 ${
                  on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'hover:bg-muted'
                }`}
              >
                {label}
              </button>
            )
          })}
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

        {/* Row 3 — 매핑선택 라디오 그룹 A + B */}
        <div className="flex flex-wrap items-center gap-3 border-b py-1.5">
          <span className="w-16 shrink-0 text-muted-foreground">매핑선택</span>
          <div className="flex items-center gap-2">
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
          <span className="text-muted-foreground">|</span>
          <div className="flex items-center gap-2">
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
        </div>

        {/* Row 4 — 검색 */}
        <form
          onSubmit={(e) => { e.preventDefault(); submitSearch() }}
          className="flex flex-wrap items-center gap-2 pt-1.5"
        >
          <span className="w-16 shrink-0 text-muted-foreground">검색</span>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="쇼핑몰상품코드 / 상품명 / 옵션"
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
          <Button onClick={() => openBulk('product')} size="sm" variant="outline" className="h-7 px-2 text-xs">
            <Plus className="size-3" /> 일괄 품번매핑
          </Button>
          <Button onClick={() => openBulk('option')} size="sm" variant="outline" className="h-7 px-2 text-xs">
            <Plus className="size-3" /> 일괄 단품매핑
          </Button>
          <Button onClick={openUnmap} size="sm" variant="outline" className="h-7 px-2 text-xs">
            매핑해제
          </Button>
          <Button onClick={() => void reload()} size="sm" variant="outline" className="h-7 px-2 text-xs">
            <RefreshCw className="size-3" /> 새로고침
          </Button>
        </div>
      </div>

      {/* ============ 2그룹 헤더 dense 테이블 ============ */}
      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th rowSpan={2} className="w-8 border-b px-1 py-1">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th colSpan={6} className="border-b border-r bg-blue-50/50 px-2 py-1 text-center font-medium">
                쇼핑몰 수집 데이터
              </th>
              <th colSpan={4} className="border-b bg-emerald-50/50 px-2 py-1 text-center font-medium">
                매핑 적용 결과
              </th>
            </tr>
            <tr className="text-[11px]">
              <th className="border-b px-1.5 py-1 text-left font-medium">쇼핑몰</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">쇼핑몰주문번호</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">쇼핑몰상품코드</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">상품명/옵션</th>
              <th className="border-b px-1.5 py-1 text-right font-medium">수량</th>
              <th className="border-b border-r px-1.5 py-1 text-center font-medium">매핑여부</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">품번-단품</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">SKU</th>
              <th className="border-b px-1.5 py-1 text-left font-medium">상품명/옵션(재고)</th>
              <th className="border-b px-1.5 py-1 text-right font-medium">수량</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={11} className="py-6 text-center text-muted-foreground">불러오는 중...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="py-6 text-center text-muted-foreground">조회 결과가 없습니다</td></tr>
            ) : rows.map((r) => {
              const split = splitProductOption(r.marketplaceItemId)
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
                      <td rowSpan={compsOrEmpty.length} className="border-r px-1.5 py-1 align-top">
                        {r.mappingStatus === 'option' ? (
                          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">단품매핑</Badge>
                        ) : r.mappingStatus === 'product' ? (
                          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">품번매핑</Badge>
                        ) : (
                          <div className="space-y-1">
                            <Badge variant="outline" className="text-muted-foreground">미매핑</Badge>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => openMapping(r, 'product')}
                                className="rounded border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted"
                                title={`품번 ${split.product} 으로 매핑`}
                              >
                                + 품번
                              </button>
                              <button
                                type="button"
                                onClick={() => openMapping(r, 'option')}
                                className="rounded border bg-background px-1.5 py-0.5 text-[10px] hover:bg-muted"
                                title={`단품 ${r.marketplaceItemId} 만 매핑`}
                              >
                                + 단품
                              </button>
                            </div>
                          </div>
                        )}
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
                </tr>
              ))
            })}
          </tbody>
        </table>
      </div>

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

      {editing && (
        <EditDialog
          state={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  )
}
