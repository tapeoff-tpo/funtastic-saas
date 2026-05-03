'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useQueryState, parseAsString } from 'nuqs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, X, RefreshCw, Search } from 'lucide-react'

export const MARKETPLACE_LABELS: Record<string, string> = {
  coupang: '쿠팡', naver: '네이버', gmarket: 'G마켓', auction: '옥션',
  elevenst: '11번가', '11st': '11번가', cafe24: 'Cafe24', ohouse: '오늘의집', kakao: '카카오',
  ably: '에이블리', ssgmall: 'SSG', domeggook: '도매꾹', tobizon: '투비즈온',
  domesin: '도매의신', 'banana-b2b': '바나나B2B', cjonestyle: 'CJ온스타일',
  'hyundai-hmall': '현대홈쇼핑', 'gs-shop': 'GS샵', esm: 'ESM',
  always: '올웨이즈', zigzag: '지그재그', 'toss-shopping': '토스쇼핑',
  ownerclan: '오너클랜', onchannel: '온채널', '10x10': '텐바이텐',
}
export const marketLabel = (id: string) => MARKETPLACE_LABELS[id] ?? id
const EXACT_OPTION_ID = '__exact__'
const DISPLAY_PAGE_SIZE = 300

function formatMarketplaceProductCode(source: MappingSourceView): string {
  if (!source.marketplaceOptionId || source.marketplaceOptionId === EXACT_OPTION_ID) {
    return source.marketplaceProductId
  }
  return `${source.marketplaceProductId}-${source.marketplaceOptionId}`
}

interface MappingSourceView {
  marketplaceId: string
  marketplaceName?: string | null
  marketplaceProductId: string
  marketplaceOptionId: string
  productNameSnapshot: string | null
  optionNameSnapshot: string | null
}

interface MappingComponentView {
  sku: string
  quantity: number
  productName: string | null
  optionName: string | null
}

interface MappingCodeRow {
  id: string
  code: string
  name: string
  note: string | null
  isActive: boolean
  sourcesCount: number
  componentsCount: number
  sources: MappingSourceView[]
  components: MappingComponentView[]
  updatedAt: string
}

interface MappingDisplayRow {
  key: string
  code: MappingCodeRow
  source: MappingSourceView | null
  component: MappingComponentView | null
  groupStart: boolean
}

interface UnmappedItem {
  marketplaceId: string
  marketplaceItemId: string
  productName: string | null
  optionText: string | null
  occurrences: number
  lastSeenAt: string | null
}

export type SourceMode = 'product' | 'option'  // 품번매핑 / 단품매핑

function formatCollectedProductName(source: MappingSourceView | null): string {
  if (!source) return '-'
  const pieces = [source.productNameSnapshot, source.optionNameSnapshot].filter(Boolean)
  return pieces.length > 0 ? pieces.join(' · ') : '-'
}

function formatConfirmedProductName(component: MappingComponentView | null, code: MappingCodeRow): string {
  if (!component) return code.name || '-'
  const pieces = [component.productName, component.optionName].filter(Boolean)
  if (pieces.length > 0) return pieces.join(' · ')
  return code.name || component.sku
}

export interface SourceForm {
  /** 'product' = 품번매핑(option_id=''), 'option' = 단품매핑(option_id 따로 입력) */
  mode: SourceMode
  marketplaceId: string
  marketplaceProductId: string
  marketplaceOptionId: string
  productNameSnapshot: string
  optionNameSnapshot: string
}
export interface ComponentForm {
  sku: string
  quantity: number
  /** 검색으로 선택된 자체상품 표시명 — UI hint 전용, 저장 시 미사용 */
  productNameHint?: string | null
  optionNameHint?: string | null
}
export interface FormState {
  id: string | null
  code: string
  name: string
  note: string
  isActive: boolean
  sources: SourceForm[]
  components: ComponentForm[]
}

export const emptyForm = (): FormState => ({
  id: null, code: '', name: '', note: '', isActive: true,
  sources: [], components: [{ sku: '', quantity: 1 }],
})

export function MappingManager() {
  const [codes, setCodes] = useState<MappingCodeRow[]>([])
  const [unmapped, setUnmapped] = useState<UnmappedItem[]>([])
  const [loading, setLoading] = useState(true)
  // 탭 전환 후 복원되도록 URL 쿼리스트링에 저장 (탭바가 마지막 URL 기억).
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''))
  const [editing, setEditing] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [displayPage, setDisplayPage] = useState(1)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [codesRes, unmappedRes] = await Promise.all([
        fetch('/api/products/mapping-codes', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/products/mapping-codes/unmapped', { cache: 'no-store' }).then((r) => r.json()),
      ])
      setCodes(codesRes.codes ?? [])
      setUnmapped(unmappedRes.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => { setDisplayPage(1) }, [search, codes.length])

  const filtered = codes.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.sources.some((s) =>
        s.marketplaceId.toLowerCase().includes(q) ||
        s.marketplaceProductId.toLowerCase().includes(q) ||
        s.marketplaceOptionId.toLowerCase().includes(q) ||
        (s.marketplaceName ?? '').toLowerCase().includes(q) ||
        (s.productNameSnapshot ?? '').toLowerCase().includes(q) ||
        (s.optionNameSnapshot ?? '').toLowerCase().includes(q) ||
        marketLabel(s.marketplaceId).toLowerCase().includes(q)
      ) ||
      c.components.some((component) =>
        component.sku.toLowerCase().includes(q) ||
        (component.productName ?? '').toLowerCase().includes(q) ||
        (component.optionName ?? '').toLowerCase().includes(q)
      )
    )
  })

  const displayRows: MappingDisplayRow[] = filtered.flatMap((code) => {
    const sources = code.sources.length > 0 ? code.sources : [null]
    const components = code.components.length > 0 ? code.components : [null]
    let idx = 0
    return sources.flatMap((source) =>
      components.map((component) => ({
        key: `${code.id}:${source?.marketplaceId ?? 'none'}:${source?.marketplaceProductId ?? 'none'}:${source?.marketplaceOptionId ?? 'none'}:${component?.sku ?? 'none'}:${idx}`,
        code,
        source,
        component,
        groupStart: idx++ === 0,
      }))
    )
  })
  const totalDisplayPages = Math.max(1, Math.ceil(displayRows.length / DISPLAY_PAGE_SIZE))
  const safeDisplayPage = Math.min(displayPage, totalDisplayPages)
  const visibleRows = displayRows.slice(
    (safeDisplayPage - 1) * DISPLAY_PAGE_SIZE,
    safeDisplayPage * DISPLAY_PAGE_SIZE,
  )

  async function openCreate(prefillSource?: UnmappedItem, prefillMode: SourceMode = 'option') {
    const form = emptyForm()
    if (prefillSource) {
      form.name = prefillSource.productName ?? ''
      // marketplaceItemId 가 `{prod}-{opt}` 형태면 split, 아니면 그대로 productId 로 사용
      const id = prefillSource.marketplaceItemId
      const sepIdx = id.indexOf('-')
      const split = prefillMode === 'option' && sepIdx > 0
        ? { product: id.slice(0, sepIdx), option: id.slice(sepIdx + 1) }
        : prefillMode === 'product' && sepIdx > 0
          ? { product: id.slice(0, sepIdx), option: '' }
          : { product: id, option: prefillMode === 'option' ? EXACT_OPTION_ID : '' }
      form.sources.push({
        mode: split.option ? 'option' : 'product',
        marketplaceId: prefillSource.marketplaceId,
        marketplaceProductId: split.product,
        marketplaceOptionId: split.option,
        productNameSnapshot: prefillSource.productName ?? '',
        optionNameSnapshot: prefillSource.optionText ?? '',
      })
    } else {
      // 빈 폼 생성 시에도 선택한 모드의 빈 source 행 1개 자동 추가
      form.sources.push({
        mode: prefillMode,
        marketplaceId: '',
        marketplaceProductId: '',
        marketplaceOptionId: '',
        productNameSnapshot: '',
        optionNameSnapshot: '',
      })
    }
    setEditing(form)
  }

  async function openEdit(id: string) {
    const res = await fetch(`/api/products/mapping-codes/${id}`)
    if (!res.ok) return alert('매핑코드를 불러올 수 없습니다')
    const data = await res.json()
    setEditing({
      id: data.code.id,
      code: data.code.code,
      name: data.code.name,
      note: data.code.note ?? '',
      isActive: data.code.isActive,
      sources: (data.sources ?? []).map((s: {
        marketplaceId: string; marketplaceProductId: string; marketplaceOptionId: string
        productNameSnapshot: string | null; optionNameSnapshot: string | null
      }) => ({
        mode: (s.marketplaceOptionId ? 'option' : 'product') as SourceMode,
        marketplaceId: s.marketplaceId,
        marketplaceProductId: s.marketplaceProductId,
        marketplaceOptionId: s.marketplaceOptionId ?? '',
        productNameSnapshot: s.productNameSnapshot ?? '',
        optionNameSnapshot: s.optionNameSnapshot ?? '',
      })),
      components: (data.components ?? []).map((c: {
        sku: string; quantity: number; productName?: string | null; optionName?: string | null
      }) => ({
        sku: c.sku,
        quantity: c.quantity,
        productNameHint: c.productName ?? null,
        optionNameHint: c.optionName ?? null,
      })),
    })
  }

  async function handleSave() {
    if (!editing) return
    if (!editing.code.trim() || !editing.name.trim()) {
      return alert('매핑코드와 이름을 입력하세요')
    }
    if (editing.components.length === 0 || editing.components.some((c) => !c.sku.trim())) {
      return alert('SKU 구성품을 1개 이상 입력하세요')
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
          sources: editing.sources.filter((s) => s.marketplaceId && s.marketplaceProductId).map((s) => ({
            marketplaceId: s.marketplaceId,
            marketplaceProductId: s.marketplaceProductId.trim(),
            // mode === 'product' 이면 option_id 강제 비움 (품번매핑)
            marketplaceOptionId: s.mode === 'option' ? s.marketplaceOptionId.trim() : '',
            productNameSnapshot: s.productNameSnapshot.trim() || null,
            optionNameSnapshot: s.optionNameSnapshot.trim() || null,
          })),
          components: editing.components.filter((c) => c.sku.trim()).map((c) => ({
            sku: c.sku.trim(),
            quantity: c.quantity,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return alert(err.error ?? '저장 실패')
      }
      setEditing(null)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, code: string) {
    if (!confirm(`매핑코드 "${code}" 를 삭제하시겠습니까?`)) return
    const res = await fetch(`/api/products/mapping-codes/${id}`, { method: 'DELETE' })
    if (!res.ok) return alert('삭제 실패')
    await reload()
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      {/* 좌측 — 매핑코드 목록 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => void setSearch(e.target.value)}
            placeholder="코드 또는 이름 검색"
            className="flex-1 rounded-md border px-3 py-1.5 text-sm"
          />
          <Button onClick={() => openCreate(undefined, 'product')} size="sm">
            <Plus className="size-3.5" />
            신규 품번매핑
          </Button>
          <Button onClick={() => openCreate(undefined, 'option')} size="sm">
            <Plus className="size-3.5" />
            신규 단품매핑
          </Button>
          <Button onClick={() => void reload()} size="sm" variant="outline">
            <RefreshCw className="size-3.5" />
            새로고침
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span>
            매핑코드 {filtered.length.toLocaleString('ko-KR')}개 · 표시행 {displayRows.length.toLocaleString('ko-KR')}개
            {displayRows.length > DISPLAY_PAGE_SIZE && (
              <span> · 현재 {((safeDisplayPage - 1) * DISPLAY_PAGE_SIZE + 1).toLocaleString('ko-KR')}-{Math.min(safeDisplayPage * DISPLAY_PAGE_SIZE, displayRows.length).toLocaleString('ko-KR')}행</span>
            )}
          </span>
          {displayRows.length > DISPLAY_PAGE_SIZE && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDisplayPage((p) => Math.max(1, p - 1))}
                disabled={safeDisplayPage <= 1}
                className="rounded border bg-background px-2 py-0.5 disabled:opacity-40"
              >
                이전
              </button>
              <span>{safeDisplayPage} / {totalDisplayPages}</span>
              <button
                type="button"
                onClick={() => setDisplayPage((p) => Math.min(totalDisplayPages, p + 1))}
                disabled={safeDisplayPage >= totalDisplayPages}
                className="rounded border bg-background px-2 py-0.5 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-[1320px] w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="w-[100px] whitespace-nowrap px-3 py-2 text-left font-medium">쇼핑몰</th>
                <th className="w-[180px] whitespace-nowrap px-3 py-2 text-left font-medium">쇼핑몰상품코드</th>
                <th className="w-[150px] whitespace-nowrap px-3 py-2 text-left font-medium">매핑코드</th>
                <th className="w-[70px] whitespace-nowrap px-3 py-2 text-right font-medium">수량</th>
                <th className="min-w-[260px] whitespace-nowrap px-3 py-2 text-left font-medium">수집상품명</th>
                <th className="min-w-[260px] whitespace-nowrap px-3 py-2 text-left font-medium">확정상품명</th>
                <th className="w-[80px] whitespace-nowrap px-3 py-2 text-right font-medium">마켓상품</th>
                <th className="w-[80px] whitespace-nowrap px-3 py-2 text-right font-medium">구성품</th>
                <th className="w-[80px] whitespace-nowrap px-3 py-2 text-center font-medium">상태</th>
                <th className="px-3 py-2 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">불러오는 중...</td></tr>
              ) : displayRows.length === 0 ? (
                <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">
                  {search ? '검색 결과가 없습니다' : '매핑코드가 없습니다. 우측 미매핑 목록에서 항목을 클릭해 추가하거나, 신규 매핑 버튼을 누르세요.'}
                </td></tr>
              ) : visibleRows.map(({ key, code: c, source, component, groupStart }) => (
                <tr key={key} className={`hover:bg-muted/30 ${groupStart ? 'border-t-2 border-t-slate-200' : ''}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">
                    {source ? (
                      <Badge variant="outline">{source.marketplaceName ?? marketLabel(source.marketplaceId)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    {source ? (
                      formatMarketplaceProductCode(source)
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    <button
                      type="button"
                      onClick={() => void openEdit(c.id)}
                      className="text-blue-600 hover:underline"
                    >
                      {component?.sku ?? c.code}
                    </button>
                    {c.components.length > 1 && component && (
                      <div className="mt-0.5 font-sans text-[10px] text-muted-foreground">세트 구성품</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{component?.quantity ?? '-'}</td>
                  <td className="max-w-[320px] px-3 py-2">
                    <div className="truncate" title={formatCollectedProductName(source)}>
                      {formatCollectedProductName(source)}
                    </div>
                  </td>
                  <td className="max-w-[320px] px-3 py-2">
                    <div className="truncate" title={formatConfirmedProductName(component, c)}>
                      {formatConfirmedProductName(component, c)}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{c.sourcesCount}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{c.componentsCount}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-center">
                    {c.isActive ? <Badge variant="secondary">활성</Badge> : <Badge variant="outline">비활성</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void handleDelete(c.id, c.code)}
                      aria-label="삭제"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 우측 — 미매핑 마켓상품 */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">미매핑 마켓상품</h2>
          <span className="text-xs text-muted-foreground">최근 90일 · 빈도순</span>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <div className="max-h-[600px] overflow-y-auto">
            {loading ? (
              <div className="py-6 text-center text-xs text-muted-foreground">불러오는 중...</div>
            ) : unmapped.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">미매핑 항목 없음</div>
            ) : unmapped.map((u) => {
              const sepIdx = u.marketplaceItemId.indexOf('-')
              const hasOptionPart = sepIdx > 0
              const productPart = hasOptionPart ? u.marketplaceItemId.slice(0, sepIdx) : u.marketplaceItemId
              const optionPart = hasOptionPart ? u.marketplaceItemId.slice(sepIdx + 1) : ''
              return (
                <div
                  key={`${u.marketplaceId}:${u.marketplaceItemId}`}
                  className="block w-full border-b px-3 py-2 last:border-b-0 hover:bg-muted/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium">
                      {marketLabel(u.marketplaceId)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{u.occurrences}건</span>
                  </div>
                  <div className="mt-1 truncate text-xs">{u.productName ?? '(이름 없음)'}</div>
                  {u.optionText && (
                    <div className="truncate text-[10px] text-muted-foreground">{u.optionText}</div>
                  )}
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {u.marketplaceItemId}
                    {hasOptionPart && (
                      <span className="ml-1 text-[10px] text-muted-foreground/70">
                        (품번 <strong>{productPart}</strong> / 단품 <strong>{optionPart}</strong>)
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void openCreate(u, 'product')}
                      className="rounded border bg-background px-2 py-0.5 text-[10px] hover:bg-muted"
                      title={hasOptionPart ? `품번 ${productPart} 으로 매핑 (모든 옵션)` : `${u.marketplaceItemId} 품번매핑`}
                    >
                      + 품번매핑
                    </button>
                    <button
                      type="button"
                      onClick={() => void openCreate(u, 'option')}
                      className="rounded border bg-background px-2 py-0.5 text-[10px] hover:bg-muted"
                      title={hasOptionPart ? `단품 ${u.marketplaceItemId} 만 매핑` : '단품매핑 — 코드 분리 필요'}
                    >
                      + 단품매핑
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

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

export interface DialogProps {
  state: FormState
  onChange: (s: FormState) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
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

/**
 * 사방넷 스타일 자체상품 검색 모달.
 * - 검색어 입력 → /api/products/search
 * - 결과 테이블에서 [선택] 클릭 시 onSelect 호출 + 닫힘
 * - 매핑 EditDialog 의 SKU 구성품 입력에서 호출됨
 */
export function ProductSearchDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (p: ProductSearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSearched(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`)
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
  }, [])

  const handleQueryChange = (v: string) => {
    setQuery(v)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void search(v), 300)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (debounce.current) clearTimeout(debounce.current)
    void search(query)
  }

  const fmtPrice = (v: string | null) =>
    v == null ? '-' : Number(v).toLocaleString('ko-KR')

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold">자체상품 검색</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 검색 폼 */}
        <form onSubmit={handleSubmit} className="border-b bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">검색항목</label>
            <select
              disabled
              className="rounded border bg-background px-2 py-1.5 text-xs text-muted-foreground"
            >
              <option>품번/상품명</option>
            </select>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="품번코드 또는 상품명 검색"
              className="flex-1 rounded border bg-background px-3 py-1.5 text-sm"
            />
            <Button type="submit" size="sm" disabled={loading}>
              <Search className="size-3.5" />
              {loading ? '검색 중...' : '검색'}
            </Button>
          </div>
        </form>

        {/* 결과 테이블 */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-[1] bg-muted/60">
              <tr className="border-b">
                <th className="w-10 px-2 py-2 text-center font-medium">No</th>
                <th className="px-2 py-2 text-left font-medium">품번코드(자체상품코드)</th>
                <th className="px-2 py-2 text-left font-medium">상품명 / 옵션</th>
                <th className="px-2 py-2 text-right font-medium">판매가</th>
                <th className="px-2 py-2 text-right font-medium">원가 / 이익률</th>
                <th className="px-2 py-2 text-right font-medium">재고</th>
                <th className="w-16 px-2 py-2 text-center font-medium">선택</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground">
                    불러오는 중...
                  </td>
                </tr>
              ) : !searched ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground">
                    품번코드 또는 상품명을 입력하고 검색하세요
                  </td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-muted-foreground">
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
                          onClick={() => {
                            onSelect(p)
                            onClose()
                          }}
                          className="rounded border bg-background px-2 py-0.5 text-[11px] hover:bg-blue-50 hover:border-blue-300"
                        >
                          선택
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
          <span>
            {searched && !loading ? `${results.length}건` : ''}
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  )
}

export function EditDialog({ state, onChange, onClose, onSave, saving }: DialogProps) {
  // 자체상품 검색 모달 — 어떤 components 행을 채울지 idx 로 추적 (-1 = 닫힘)
  // 신규 매핑(state.id === null) 일 때는 EditDialog 가 열리는 즉시 0번 행 검색을 자동 오픈 — 사방넷 UX
  const isNew = state.id === null
  const [searchIdx, setSearchIdx] = useState<number>(isNew ? 0 : -1)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{state.id ? '매핑코드 편집' : '신규 매핑코드'}</h2>
          <button onClick={onClose} aria-label="닫기" className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">매핑코드 *</label>
              <input
                type="text"
                value={state.code}
                onChange={(e) => onChange({ ...state, code: e.target.value })}
                placeholder="예: MC-A001"
                className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">이름 *</label>
              <input
                type="text"
                value={state.name}
                onChange={(e) => onChange({ ...state, name: e.target.value })}
                placeholder="예: 갤러그 라떼 단품"
                className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground">메모</label>
            <input
              type="text"
              value={state.note}
              onChange={(e) => onChange({ ...state, note: e.target.value })}
              className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.isActive}
              onChange={(e) => onChange({ ...state, isActive: e.target.checked })}
            />
            활성
          </label>

          {/* Sources */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium">마켓상품 ({state.sources.length})</label>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onChange({
                    ...state,
                    sources: [...state.sources, {
                      mode: 'product',
                      marketplaceId: '', marketplaceProductId: '', marketplaceOptionId: '',
                      productNameSnapshot: '', optionNameSnapshot: '',
                    }],
                  })}
                  className="text-blue-600 hover:underline"
                >
                  + 품번매핑
                </button>
                <span className="text-muted-foreground">|</span>
                <button
                  type="button"
                  onClick={() => onChange({
                    ...state,
                    sources: [...state.sources, {
                      mode: 'option',
                      marketplaceId: '', marketplaceProductId: '', marketplaceOptionId: '',
                      productNameSnapshot: '', optionNameSnapshot: '',
                    }],
                  })}
                  className="text-blue-600 hover:underline"
                >
                  + 단품매핑
                </button>
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
              <strong>품번매핑</strong>: 상품ID 만 입력 — 그 품번 아래 모든 옵션이 자동 매핑.
              <strong> 단품매핑</strong>: 상품ID + 단품코드 — 특정 옵션만 매핑 (단품매핑이 품번매핑보다 우선).
              예) 마켓 상품코드가 <code>111924-0001</code> 이면 품번 = <code>111924</code>, 단품 = <code>0001</code>.
            </div>
            <div className="space-y-1 mt-1">
              {state.sources.length === 0 && (
                <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  마켓상품을 추가하지 않으면 자동매핑이 동작하지 않습니다
                </div>
              )}
              {state.sources.map((s, idx) => (
                <div key={idx} className="rounded-md border p-1.5">
                  <div className="grid grid-cols-[64px_80px_120px_100px_1fr_24px] items-center gap-1.5">
                    <select
                      value={s.mode}
                      onChange={(e) => {
                        const next = [...state.sources]
                        const newMode = e.target.value as SourceMode
                        next[idx] = {
                          ...next[idx],
                          mode: newMode,
                          // 품번매핑으로 전환 시 단품코드 초기화
                          marketplaceOptionId: newMode === 'product' ? '' : next[idx].marketplaceOptionId,
                        }
                        onChange({ ...state, sources: next })
                      }}
                      className="rounded border px-1 py-1 text-[11px]"
                      title="매핑 종류"
                    >
                      <option value="product">품번</option>
                      <option value="option">단품</option>
                    </select>
                    <select
                      value={s.marketplaceId}
                      onChange={(e) => {
                        const next = [...state.sources]
                        next[idx] = { ...next[idx], marketplaceId: e.target.value }
                        onChange({ ...state, sources: next })
                      }}
                      className="rounded border px-1.5 py-1 text-xs"
                    >
                      <option value="">마켓</option>
                      {Object.entries(MARKETPLACE_LABELS).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={s.marketplaceProductId}
                      onChange={(e) => {
                        const next = [...state.sources]
                        next[idx] = { ...next[idx], marketplaceProductId: e.target.value }
                        onChange({ ...state, sources: next })
                      }}
                      placeholder="상품ID(품번)"
                      className="rounded border px-1.5 py-1 font-mono text-xs"
                    />
                    <input
                      type="text"
                      value={s.marketplaceOptionId}
                      onChange={(e) => {
                        const next = [...state.sources]
                        next[idx] = { ...next[idx], marketplaceOptionId: e.target.value }
                        onChange({ ...state, sources: next })
                      }}
                      placeholder={s.mode === 'option' ? '단품코드' : '(품번매핑)'}
                      disabled={s.mode === 'product'}
                      className="rounded border px-1.5 py-1 font-mono text-xs disabled:bg-muted/40 disabled:text-muted-foreground"
                    />
                    <input
                      type="text"
                      value={s.productNameSnapshot}
                      onChange={(e) => {
                        const next = [...state.sources]
                        next[idx] = { ...next[idx], productNameSnapshot: e.target.value }
                        onChange({ ...state, sources: next })
                      }}
                      placeholder="상품명 (참조용)"
                      className="rounded border px-1.5 py-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => onChange({ ...state, sources: state.sources.filter((_, i) => i !== idx) })}
                      aria-label="행 제거"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Components */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium">SKU 구성품 ({state.components.length}) *</label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    // 검색 모달을 새 행 모드로 열기 — 현재 빈 행이 있으면 그 idx, 없으면 새 행 추가 후 그 idx
                    const emptyIdx = state.components.findIndex((c) => !c.sku.trim())
                    if (emptyIdx >= 0) {
                      setSearchIdx(emptyIdx)
                    } else {
                      const nextIdx = state.components.length
                      onChange({
                        ...state,
                        components: [...state.components, { sku: '', quantity: 1 }],
                      })
                      // setState 는 비동기지만 setSearchIdx 는 idx 만 저장하므로 안전
                      setSearchIdx(nextIdx)
                    }
                  }}
                  className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  <Search className="mr-1 inline size-3" />
                  자체상품 검색
                </button>
                <button
                  type="button"
                  onClick={() => onChange({
                    ...state,
                    components: [...state.components, { sku: '', quantity: 1 }],
                  })}
                  className="rounded border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  + 빈 행
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {state.components.map((c, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_60px_80px_24px] items-center gap-1.5 rounded-md border p-1.5">
                  <div className="min-w-0">
                    <input
                      type="text"
                      value={c.sku}
                      onChange={(e) => {
                        const next = [...state.components]
                        next[idx] = { ...next[idx], sku: e.target.value, productNameHint: null, optionNameHint: null }
                        onChange({ ...state, components: next })
                      }}
                      placeholder="SKU (검색 또는 직접 입력)"
                      className="w-full rounded border px-1.5 py-1 font-mono text-xs"
                    />
                    {(c.productNameHint || c.optionNameHint) && (
                      <div className="mt-0.5 truncate px-1 text-[10px] text-muted-foreground">
                        {c.productNameHint}
                        {c.optionNameHint && <span className="ml-1">· {c.optionNameHint}</span>}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSearchIdx(idx)}
                    aria-label="자체상품 검색"
                    title="자체상품 검색"
                    className="flex h-6 items-center justify-center gap-0.5 rounded border bg-background px-1.5 text-[11px] text-muted-foreground hover:bg-blue-50 hover:text-blue-700"
                  >
                    <Search className="size-3" />
                    검색
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={c.quantity}
                    onChange={(e) => {
                      const next = [...state.components]
                      next[idx] = { ...next[idx], quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }
                      onChange({ ...state, components: next })
                    }}
                    className="rounded border px-1.5 py-1 text-right text-xs tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => onChange({ ...state, components: state.components.filter((_, i) => i !== idx) })}
                    aria-label="행 제거"
                    disabled={state.components.length <= 1}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} size="sm">취소</Button>
            <Button onClick={onSave} disabled={saving} size="sm">
              {saving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </div>
      </div>

      <ProductSearchDialog
        open={searchIdx >= 0}
        onClose={() => setSearchIdx(-1)}
        onSelect={(p) => {
          if (searchIdx < 0) return
          const next = [...state.components]
          next[searchIdx] = {
            ...next[searchIdx],
            sku: p.internalSku,
            productNameHint: p.name,
            optionNameHint: p.optionHint ?? null,
          }
          // 매핑코드 / 이름이 비어있으면 첫 선택을 기준으로 자동 prefill — 사방넷 UX
          const autoCode = !state.code.trim() ? p.internalSku : state.code
          const autoName = !state.name.trim() ? p.name : state.name
          onChange({
            ...state,
            code: autoCode,
            name: autoName,
            components: next,
          })
        }}
      />
    </div>
  )
}
