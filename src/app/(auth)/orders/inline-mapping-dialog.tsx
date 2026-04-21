'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'

interface OrderItem {
  productName: string
  optionText: string | null
  quantity: number
}

interface ProductSearchResult {
  id: string
  internalSku: string
  name: string
  warehouseLocation: string | null
}

interface InlineMappingDialogProps {
  open: boolean
  marketplaceId: string
  items: OrderItem[]
  onClose: () => void
  onSaved: () => void
}

/**
 * 주문에서 바로 매핑 — 미매핑 아이템들만 표시하고 각각 상품 검색으로 매핑
 */
export function InlineMappingDialog({
  open,
  marketplaceId,
  items,
  onClose,
  onSaved,
}: InlineMappingDialogProps) {
  const [mappings, setMappings] = useState<Record<string, ProductSearchResult | null>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setMappings({})
  }, [open])

  if (!open) return null

  const handleSelectProduct = (itemName: string, product: ProductSearchResult) => {
    setMappings((prev) => ({ ...prev, [itemName]: product }))
  }

  const handleSaveAll = async () => {
    const entries = Object.entries(mappings).filter(([, p]) => p !== null)
    if (entries.length === 0) {
      toast.error('매핑할 상품을 선택하세요.')
      return
    }
    setSaving(true)
    try {
      let success = 0
      let failed = 0
      for (const [marketplaceName, product] of entries) {
        if (!product) continue
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl rounded-lg border bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="mb-2 text-lg font-semibold">주문 상품 매핑</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          매핑이 필요한 상품들을 우리 상품과 연결하세요.
        </p>

        <div className="space-y-4">
          {items.map((item, idx) => {
            const selected = mappings[item.productName]
            return (
              <div key={`${item.productName}-${idx}`} className="rounded-md border p-3">
                <div className="mb-2">
                  <p className="text-sm font-medium">{item.productName}</p>
                  {item.optionText && (
                    <p className="text-xs text-muted-foreground">{item.optionText}</p>
                  )}
                  <p className="text-xs text-muted-foreground">수량: {item.quantity}</p>
                </div>
                <ProductSearch
                  onSelect={(p) => handleSelectProduct(item.productName, p)}
                />
                {selected && (
                  <p className="mt-2 text-xs text-green-600">
                    ✓ {selected.internalSku} - {selected.name}
                  </p>
                )}
              </div>
            )
          })}
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
            onClick={() => void handleSaveAll()}
            disabled={saving || Object.keys(mappings).length === 0}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '전체 저장'}
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
