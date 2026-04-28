'use client'

import { useEffect, useState, useTransition, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Pagination } from '@/components/ui/pagination'

const MARKETPLACE_LABELS: Record<string, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  gmarket: 'G마켓',
  auction: '옥션',
  elevenst: '11번가',
  cafe24: '카페24',
  ohouse: '오늘의집',
  kakao: '카카오',
  'kakao-gift': '카카오선물',
  'kakao-store': '카카오스토어',
  ably: '에이블리',
  domeggook: '도매꾹',
  onchannel: '온채널',
  ownerclan: '오너클랜',
  ssgmall: 'SSG몰',
}

function marketplaceLabel(id: string) {
  return MARKETPLACE_LABELS[id] ?? id
}

interface Suggestion {
  productId: string
  name: string
  sku: string
  score: number
}

interface UnmappedItem {
  marketplaceId: string
  productName: string
  orderCount: number
  lastOrderedAt: string
  suggestions?: Suggestion[]
}

interface MappingItem {
  id: string
  marketplaceId: string
  marketplaceName: string
  displayName: string
  productId: string | null
  productName: string | null
  /** 매핑 시 order_items.sku 로 들어가는 실제 재고관리코드 */
  productSku: string | null
  updatedAt: string
}

interface ProductSearchResult {
  id: string
  internalSku: string
  name: string
  warehouseLocation: string | null
  optionHint?: string | null
}

// ── Product Search Component ──
function ProductSearch({
  onSelect,
}: {
  onSelect: (product: ProductSearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data.results ?? [])
      setShowDropdown(true)
    } catch { /* ignore */ }
    setSearching(false)
  }, [])

  const handleChange = (value: string) => {
    setQuery(value)
    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = setTimeout(() => search(value), 300)
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <label className="mb-1 block text-sm font-medium">
        상품 검색 (상품코드 또는 상품명)
      </label>
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        placeholder="예: 111975-0001 또는 컬린디"
        className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
      />
      {searching && (
        <p className="mt-1 text-xs text-muted-foreground">검색 중...</p>
      )}
      {showDropdown && results.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-white shadow-lg">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                onSelect(p)
                setQuery(`${p.internalSku} - ${p.name}`)
                setShowDropdown(false)
              }}
            >
              <span className="font-mono text-xs text-muted-foreground">{p.internalSku}</span>
              <span className="flex-1 truncate">{p.name}</span>
              {p.optionHint && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                  {p.optionHint}
                </span>
              )}
              {p.warehouseLocation && (
                <span className="text-xs text-muted-foreground">{p.warehouseLocation}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {showDropdown && results.length === 0 && query.length >= 1 && !searching && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-white p-3 text-center text-sm text-muted-foreground shadow-lg">
          검색 결과 없음
        </div>
      )}
    </div>
  )
}

// ── Mapping Dialog ──
interface MappingDialogProps {
  item: UnmappedItem | MappingItem | null
  mode: 'create' | 'edit'
  onClose: () => void
  onSaved: () => void
}

function MappingDialog({ item, mode, onClose, onSaved }: MappingDialogProps) {
  const [displayName, setDisplayName] = useState(
    mode === 'edit' ? (item as MappingItem).displayName : '',
  )
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    mode === 'edit' ? (item as MappingItem).productId : null,
  )
  // 수정 모드일 땐 기존 매핑의 상품코드를 보여줌 — ProductSearch 로 새로 선택하면 갱신.
  const [selectedProductSku, setSelectedProductSku] = useState<string | null>(
    mode === 'edit' ? (item as MappingItem).productSku ?? null : null,
  )
  const [pickingLocation, setPickingLocation] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (mode === 'create' && item && !displayName) {
      setDisplayName((item as UnmappedItem).productName)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])

  if (!item) return null

  const marketplaceId =
    mode === 'create'
      ? (item as UnmappedItem).marketplaceId
      : (item as MappingItem).marketplaceId
  const marketplaceName =
    mode === 'create'
      ? (item as UnmappedItem).productName
      : (item as MappingItem).marketplaceName

  const handleProductSelect = (product: ProductSearchResult) => {
    setDisplayName(product.name)
    setSelectedProductId(product.id)
    setSelectedProductSku(product.internalSku)
    setPickingLocation(product.warehouseLocation)
  }

  const handleSave = () => {
    if (!displayName.trim()) return
    startTransition(async () => {
      try {
        let res: Response
        if (mode === 'edit') {
          res = await fetch(`/api/products/mappings/${(item as MappingItem).id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName, productId: selectedProductId }),
          })
        } else {
          res = await fetch('/api/products/mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              marketplaceId,
              marketplaceName,
              displayName,
              productId: selectedProductId,
              pickingLocation,
            }),
          })
        }
        if (!res.ok) {
          const data = await res.json()
          toast.error(data.error || '저장 실패')
          return
        }
        toast.success('매핑이 저장되었습니다')
        onSaved()
        onClose()
      } catch {
        toast.error('네트워크 오류')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg border bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">
          {mode === 'create' ? '상품명 매핑 추가' : '매핑 수정'}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted-foreground">
              마켓 / 마켓 상품명
            </label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="mr-2 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
                {marketplaceLabel(marketplaceId)}
              </span>
              {marketplaceName}
            </div>
          </div>

          {/* Product search */}
          <ProductSearch onSelect={handleProductSelect} />

          <div>
            <label
              htmlFor="display-name"
              className="mb-1 block text-sm font-medium"
            >
              내부 상품명 (송장 출력용) <span className="text-red-500">*</span>
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="예: 닭가슴살 300g x5"
              className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              상품을 검색하면 자동으로 채워집니다. 직접 입력도 가능합니다.
            </p>
          </div>

          {selectedProductId && (
            <p className="text-xs text-green-600">
              상품 연결됨{' '}
              {selectedProductSku && (
                <span className="font-mono">— 상품코드 {selectedProductSku}</span>
              )}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || !displayName.trim()}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Manager ──
export function MappingManager() {
  const [mappings, setMappings] = useState<MappingItem[]>([])
  const [unmapped, setUnmapped] = useState<UnmappedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{
    item: UnmappedItem | MappingItem
    mode: 'create' | 'edit'
  } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [unmappedSearch, setUnmappedSearch] = useState('')
  const [mappingSearch, setMappingSearch] = useState('')
  const [selectedMarket, setSelectedMarket] = useState<string>('all')
  const [autoMapping, setAutoMapping] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importMarket, setImportMarket] = useState('naver')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

  // Pagination state for each section
  const [unmappedPage, setUnmappedPage] = useState(1)
  const [unmappedPageSize, setUnmappedPageSize] = useState(20)
  const [mappingPage, setMappingPage] = useState(1)
  const [mappingPageSize, setMappingPageSize] = useState(20)

  // Selection + bulk mapping
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [bulkTarget, setBulkTarget] = useState<ProductSearchResult | null>(null)
  const [bulkApplying, setBulkApplying] = useState(false)
  const [applyingKey, setApplyingKey] = useState<string | null>(null)

  const keyOf = (u: UnmappedItem) => `${u.marketplaceId}::${u.productName}`

  const toggleKey = (k: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const applySuggestion = async (u: UnmappedItem, s: Suggestion) => {
    const k = keyOf(u)
    setApplyingKey(k)
    try {
      const res = await fetch('/api/products/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketplaceId: u.marketplaceId,
          marketplaceName: u.productName,
          displayName: s.name,
          productId: s.productId,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || '매핑 실패')
        return
      }
      toast.success(`${marketplaceLabel(u.marketplaceId)} → ${s.name}`)
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        next.delete(k)
        return next
      })
      void load()
    } catch {
      toast.error('네트워크 오류')
    } finally {
      setApplyingKey(null)
    }
  }

  const applyBulk = async () => {
    if (!bulkTarget || selectedKeys.size === 0) return
    setBulkApplying(true)
    try {
      const targets = unmapped.filter((u) => selectedKeys.has(keyOf(u)))
      const results = await Promise.all(
        targets.map((u) =>
          fetch('/api/products/mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              marketplaceId: u.marketplaceId,
              marketplaceName: u.productName,
              displayName: bulkTarget.name,
              productId: bulkTarget.id,
            }),
          }).then((r) => r.ok),
        ),
      )
      const ok = results.filter(Boolean).length
      const fail = results.length - ok
      if (fail === 0) toast.success(`${ok}건 매핑 완료 → ${bulkTarget.name}`)
      else toast.warning(`${ok}건 성공 / ${fail}건 실패`)
      setSelectedKeys(new Set())
      setBulkTarget(null)
      void load()
    } catch {
      toast.error('일괄 매핑 실패')
    } finally {
      setBulkApplying(false)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/products/mappings')
      const data = await res.json()
      setMappings(data.mappings ?? [])
      setUnmapped(data.unmapped ?? [])
    } catch {
      toast.error('불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('이 매핑을 삭제하시겠습니까?')) return
    setDeletingId(id)
    try {
      await fetch(`/api/products/mappings/${id}`, { method: 'DELETE' })
      toast.success('삭제되었습니다')
      void load()
    } catch {
      toast.error('삭제 실패')
    } finally {
      setDeletingId(null)
    }
  }

  const handleAutoMapping = async () => {
    setAutoMapping(true)
    try {
      const res = await fetch('/api/products/mappings/auto', { method: 'POST' })
      const data = await res.json()
      if (data.matched > 0) {
        toast.success(data.message)
        void load()
      } else {
        toast.info(data.message)
      }
    } catch {
      toast.error('자동 매핑 실패')
    } finally {
      setAutoMapping(false)
    }
  }

  const handleExcelImport = async () => {
    if (!importFile) return
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', importFile)
      formData.append('marketplaceId', importMarket)
      const res = await fetch('/api/products/mappings/import', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || '업로드 실패')
      } else {
        toast.success(data.message, { duration: 5000 })
        if (data.unmatchedSamples?.length > 0) {
          const samples = data.unmatchedSamples
            .map((s: { code: string; name: string }) => `• ${s.code} (${s.name})`)
            .join('\n')
          toast.info(`미매칭 샘플:\n${samples}`, { duration: 10000 })
        }
        setShowImport(false)
        setImportFile(null)
        void load()
      }
    } catch {
      toast.error('업로드 실패')
    } finally {
      setImporting(false)
    }
  }

  const allMarkets = Array.from(
    new Set([
      ...unmapped.map((u) => u.marketplaceId),
      ...mappings.map((m) => m.marketplaceId),
    ]),
  ).sort()

  const filteredUnmapped = unmapped.filter((u) => {
    if (selectedMarket !== 'all' && u.marketplaceId !== selectedMarket) return false
    if (unmappedSearch && !u.productName.toLowerCase().includes(unmappedSearch.toLowerCase())) return false
    return true
  })

  const filteredMappings = mappings.filter((m) => {
    if (selectedMarket !== 'all' && m.marketplaceId !== selectedMarket) return false
    if (mappingSearch) {
      const q = mappingSearch.toLowerCase()
      const sku = m.productSku?.toLowerCase() ?? ''
      if (
        !m.marketplaceName.toLowerCase().includes(q) &&
        !m.displayName.toLowerCase().includes(q) &&
        !sku.includes(q)
      )
        return false
    }
    return true
  })

  // Pagination calculations
  const unmappedTotal = filteredUnmapped.length
  const unmappedTotalPages = Math.max(1, Math.ceil(unmappedTotal / unmappedPageSize))
  const currentUnmappedPage = Math.min(unmappedPage, unmappedTotalPages)
  const pagedUnmapped = filteredUnmapped.slice(
    (currentUnmappedPage - 1) * unmappedPageSize,
    currentUnmappedPage * unmappedPageSize,
  )

  const mappingTotal = filteredMappings.length
  const mappingTotalPages = Math.max(1, Math.ceil(mappingTotal / mappingPageSize))
  const currentMappingPage = Math.min(mappingPage, mappingTotalPages)
  const pagedMappings = filteredMappings.slice(
    (currentMappingPage - 1) * mappingPageSize,
    currentMappingPage * mappingPageSize,
  )

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        불러오는 중...
      </div>
    )
  }

  return (
    <>
      {dialog && (
        <MappingDialog
          item={dialog.item}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onSaved={load}
        />
      )}

      {/* Excel import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">엑셀로 매핑</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              마켓에서 다운받은 엑셀을 올리면 상품코드로 자동 매핑합니다.
              엑셀에 &quot;상품코드&quot;와 &quot;상품명&quot; 컬럼이 있어야 합니다.
            </p>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">마켓플레이스</label>
                <select
                  value={importMarket === '__custom__' || Object.keys(MARKETPLACE_LABELS).includes(importMarket) ? (Object.keys(MARKETPLACE_LABELS).includes(importMarket) ? importMarket : '__custom__') : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setImportMarket('')
                    } else {
                      setImportMarket(e.target.value)
                    }
                  }}
                  className="w-full rounded-md border px-3 py-1.5 text-sm"
                >
                  {Object.entries(MARKETPLACE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                  <option value="__custom__">기타 (직접 입력)</option>
                </select>
                {!Object.keys(MARKETPLACE_LABELS).includes(importMarket) && (
                  <input
                    type="text"
                    value={importMarket}
                    onChange={(e) => setImportMarket(e.target.value)}
                    placeholder="마켓 이름 직접 입력 (예: 현대홈쇼핑, 홈앤쇼핑)"
                    className="mt-2 w-full rounded-md border px-3 py-1.5 text-sm"
                  />
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">엑셀 파일</label>
                <label className="block cursor-pointer rounded-md border px-4 py-2 text-sm hover:bg-gray-50">
                  {importFile?.name ?? '파일 선택'}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowImport(false); setImportFile(null) }}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleExcelImport()}
                disabled={importing || !importFile || !importMarket.trim()}
                className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {importing ? '매핑 중...' : '매핑 시작'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Market filter */}
      {allMarkets.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">마켓 필터:</span>
          <button
            type="button"
            onClick={() => setSelectedMarket('all')}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              selectedMarket === 'all'
                ? 'bg-black text-white'
                : 'border hover:bg-muted'
            }`}
          >
            전체
          </button>
          {allMarkets.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSelectedMarket(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                selectedMarket === m
                  ? 'bg-black text-white'
                  : 'border hover:bg-muted'
              }`}
            >
              {marketplaceLabel(m)}
            </button>
          ))}
        </div>
      )}

      {/* ── Section 1: Unmapped ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">
              미매핑 상품명
              {filteredUnmapped.length > 0 && (
                <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
                  {filteredUnmapped.length > 99 ? '99+' : filteredUnmapped.length}
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              최근 90일 주문에서 매핑이 없는 상품명
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
            >
              엑셀로 매핑
            </button>
            {unmapped.length > 0 && (
              <button
                type="button"
                onClick={() => void handleAutoMapping()}
                disabled={autoMapping}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {autoMapping ? '매칭 중...' : '자동 매핑 (SKU)'}
              </button>
            )}
            <input
              type="text"
              value={unmappedSearch}
              onChange={(e) => setUnmappedSearch(e.target.value)}
              placeholder="상품명 검색"
              className="rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>
        </div>

        {filteredUnmapped.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            {unmapped.length === 0
              ? '미매핑 상품명이 없습니다 — 모두 매핑 완료!'
              : '검색 결과가 없습니다'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            {/* Bulk action bar */}
            {selectedKeys.size > 0 && (
              <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-blue-50 px-4 py-2.5">
                <span className="text-sm font-medium text-blue-900">
                  {selectedKeys.size}개 선택됨
                </span>
                <div className="min-w-[280px] flex-1">
                  <ProductSearch onSelect={setBulkTarget} />
                </div>
                {bulkTarget && (
                  <span className="text-xs text-blue-800">
                    → <strong>{bulkTarget.internalSku}</strong> {bulkTarget.name}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void applyBulk()}
                  disabled={!bulkTarget || bulkApplying}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulkApplying ? '적용 중...' : `선택 ${selectedKeys.size}개 일괄 매핑`}
                </button>
                <button
                  type="button"
                  onClick={() => { setSelectedKeys(new Set()); setBulkTarget(null) }}
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-white"
                >
                  선택 해제
                </button>
              </div>
            )}

            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="w-10 px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={pagedUnmapped.length > 0 && pagedUnmapped.every((u) => selectedKeys.has(keyOf(u)))}
                      onChange={(e) => {
                        setSelectedKeys((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) pagedUnmapped.forEach((u) => next.add(keyOf(u)))
                          else pagedUnmapped.forEach((u) => next.delete(keyOf(u)))
                          return next
                        })
                      }}
                      title="현재 페이지 전체 선택"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">마켓</th>
                  <th className="px-4 py-2.5 text-left font-medium">마켓 상품명</th>
                  <th className="px-4 py-2.5 text-center font-medium">주문수</th>
                  <th className="px-4 py-2.5 text-left font-medium">자동 제안</th>
                  <th className="px-4 py-2.5 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pagedUnmapped.map((item) => {
                  const k = keyOf(item)
                  const checked = selectedKeys.has(k)
                  const topSuggestion = item.suggestions?.[0]
                  return (
                    <tr
                      key={k}
                      className={`hover:bg-muted/30 ${checked ? 'bg-blue-50/50' : ''}`}
                    >
                      <td className="w-10 px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleKey(k)}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
                          {marketplaceLabel(item.marketplaceId)}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-2.5">
                        <span className="line-clamp-2 text-sm">{item.productName}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          최근: {new Date(item.lastOrderedAt).toLocaleDateString('ko-KR')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center tabular-nums">
                        {item.orderCount.toLocaleString('ko-KR')}건
                      </td>
                      <td className="max-w-[260px] px-4 py-2.5">
                        {topSuggestion ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                                  topSuggestion.score > 0.5
                                    ? 'bg-green-100 text-green-800'
                                    : topSuggestion.score > 0.3
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-gray-100 text-gray-700'
                                }`}
                                title={`유사도 ${(topSuggestion.score * 100).toFixed(0)}%`}
                              >
                                {(topSuggestion.score * 100).toFixed(0)}%
                              </span>
                              <span className="truncate text-xs">{topSuggestion.name}</span>
                            </div>
                            {(item.suggestions?.length ?? 0) > 1 && (
                              <details className="text-xs text-muted-foreground">
                                <summary className="cursor-pointer hover:text-foreground">
                                  +{(item.suggestions?.length ?? 0) - 1}개 더
                                </summary>
                                <div className="mt-1 space-y-1 border-l-2 border-muted pl-2">
                                  {item.suggestions!.slice(1).map((s) => (
                                    <div key={s.productId} className="flex items-center justify-between gap-1.5">
                                      <span className="truncate">{s.name}</span>
                                      <button
                                        type="button"
                                        onClick={() => void applySuggestion(item, s)}
                                        disabled={applyingKey === k}
                                        className="shrink-0 rounded border border-blue-200 px-1.5 py-0.5 text-xs text-blue-700 hover:bg-blue-50"
                                      >
                                        적용 {(s.score * 100).toFixed(0)}%
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {topSuggestion && (
                            <button
                              type="button"
                              onClick={() => void applySuggestion(item, topSuggestion)}
                              disabled={applyingKey === k}
                              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                              title={`${topSuggestion.name} 로 매핑`}
                            >
                              {applyingKey === k ? '적용 중...' : '제안 적용'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDialog({ item, mode: 'create' })}
                            className="rounded-md border bg-white px-2.5 py-1 text-xs hover:bg-muted"
                          >
                            수동
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pagination
              page={currentUnmappedPage}
              pageSize={unmappedPageSize}
              total={unmappedTotal}
              onPageChange={setUnmappedPage}
              onPageSizeChange={setUnmappedPageSize}
            />
          </div>
        )}
      </section>

      {/* ── Section 2: Existing mappings ── */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">
              매핑 목록{' '}
              <span className="text-sm font-normal text-muted-foreground">
                ({filteredMappings.length}개)
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              저장된 상품명 매핑 — 송장 출력 시 내부 상품명이 사용됩니다
            </p>
          </div>
          <input
            type="text"
            value={mappingSearch}
            onChange={(e) => setMappingSearch(e.target.value)}
            placeholder="상품명 검색"
            className="rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-black"
          />
        </div>

        {filteredMappings.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            {mappings.length === 0
              ? '아직 매핑이 없습니다. 위에서 미매핑 상품명을 등록하세요.'
              : '검색 결과가 없습니다'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">마켓</th>
                  <th className="px-4 py-2.5 text-left font-medium">마켓 상품명</th>
                  <th className="px-4 py-2.5 text-center font-medium">→</th>
                  <th className="px-4 py-2.5 text-left font-medium">상품코드</th>
                  <th className="px-4 py-2.5 text-left font-medium">내부 상품명 (송장용)</th>
                  <th className="px-4 py-2.5 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pagedMappings.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
                        {marketplaceLabel(m.marketplaceId)}
                      </span>
                    </td>
                    <td className="max-w-[240px] px-4 py-2.5">
                      <span className="line-clamp-2 text-sm text-muted-foreground">
                        {m.marketplaceName}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center text-muted-foreground">→</td>
                    <td className="px-4 py-2.5">
                      {m.productSku ? (
                        <span className="font-mono text-xs">{m.productSku}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{m.displayName}</span>
                      {m.productName && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({m.productName})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setDialog({ item: m, mode: 'edit' })}
                          className="rounded border px-2.5 py-1 text-xs hover:bg-muted"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(m.id)}
                          disabled={deletingId === m.id}
                          className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={currentMappingPage}
              pageSize={mappingPageSize}
              total={mappingTotal}
              onPageChange={setMappingPage}
              onPageSizeChange={setMappingPageSize}
            />
          </div>
        )}
      </section>
    </>
  )
}
