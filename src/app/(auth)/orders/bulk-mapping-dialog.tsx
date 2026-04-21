'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import type { OrderRow } from './columns'

const MARKETPLACE_LABELS: Record<string, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  gmarket: 'G마켓',
  auction: '옥션',
  '11st': '11번가',
  cafe24: 'Cafe24',
}

interface ProductSearchResult {
  id: string
  internalSku: string
  name: string
  warehouseLocation: string | null
}

interface UnmappedItem {
  marketplaceId: string
  productName: string
  orderCount: number
}

interface BulkMappingDialogProps {
  open: boolean
  orders: OrderRow[]
  onClose: () => void
  onSaved: () => void
}

/**
 * 선택한 주문들의 미매핑 상품들을 중복 제거 후 일괄 매핑.
 */
export function BulkMappingDialog({ open, orders, onClose, onSaved }: BulkMappingDialogProps) {
  const [mappings, setMappings] = useState<Record<string, ProductSearchResult | null>>({})
  const [saving, setSaving] = useState(false)

  // 미매핑 or 일부매핑 주문들에서 중복 제거하여 매핑 필요 목록 생성
  const unmappedItems = useMemo<UnmappedItem[]>(() => {
    const map = new Map<string, UnmappedItem>()
    for (const order of orders) {
      if (order.mappingStatus === 'mapped') continue
      for (const item of order.items) {
        const key = `${order.marketplaceId}::${item.productName}`
        const existing = map.get(key)
        if (existing) existing.orderCount++
        else map.set(key, { marketplaceId: order.marketplaceId, productName: item.productName, orderCount: 1 })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.orderCount - a.orderCount)
  }, [orders])

  useEffect(() => { if (open) setMappings({}) }, [open])

  if (!open) return null

  const handleSelect = (key: string, product: ProductSearchResult) => {
    setMappings((prev) => ({ ...prev, [key]: product }))
  }

  const handleSaveAll = async () => {
    const entries = Object.entries(mappings).filter(([, p]) => p !== null)
    if (entries.length === 0) {
      toast.error('매핑할 상품을 하나 이상 선택하세요.')
      return
    }
    setSaving(true)
    try {
      let success = 0
      let failed = 0
      for (const [key, product] of entries) {
        if (!product) continue
        const [marketplaceId, marketplaceName] = key.split('::')
        const res = await fetch('/api/products/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketplaceId,
            marketplaceName,
            displayName: product.name,
            productId: product.id,
            pickingLocation: product.warehouseLocation,
          }),
        })
        if (res.ok) success++
        else failed++
      }
      if (success > 0) toast.success(`${success}건 매핑 완료`)
      if (failed > 0) toast.error(`${failed}건 실패`)
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-full max-w-3xl rounded-lg border bg-white p-6 shadow-xl max-h-[90vh] flex flex-col">
        <h2 className="mb-2 text-lg font-semibold">일괄 매핑</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          선택한 주문 {orders.length}건에서 매핑되지 않은 상품 {unmappedItems.length}개 (중복 제외).
        </p>

        {unmappedItems.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            매핑이 필요한 상품이 없습니다 — 모두 매핑 완료!
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3">
            {unmappedItems.map((item) => {
              const key = `${item.marketplaceId}::${item.productName}`
              const selected = mappings[key]
              return (
                <div key={key} className="rounded-md border p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
                          {MARKETPLACE_LABELS[item.marketplaceId] ?? item.marketplaceId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {item.orderCount}건
                        </span>
                      </div>
                      <p className="text-sm line-clamp-2">{item.productName}</p>
                    </div>
                  </div>
                  <ProductSearch onSelect={(p) => handleSelect(key, p)} />
                  {selected && (
                    <p className="mt-2 text-xs text-green-600">
                      ✓ {selected.internalSku} - {selected.name}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2 border-t pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleSaveAll()}
            disabled={saving || Object.keys(mappings).length === 0}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? '저장 중...' : `매핑 저장 (${Object.keys(mappings).length}개)`}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProductSearch({ onSelect }: { onSelect: (p: ProductSearchResult) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return }
    try {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data.results ?? [])
      setShowDropdown(true)
    } catch { /* ignore */ }
  }, [])

  const handleChange = (value: string) => {
    setQuery(value)
    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = setTimeout(() => search(value), 300)
  }

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
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
        placeholder="상품코드 또는 상품명 검색"
        className="w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
      />
      {showDropdown && results.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-white shadow-lg">
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
              {p.warehouseLocation && (
                <span className="text-xs text-muted-foreground">{p.warehouseLocation}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
