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
  optionHint?: string | null
}

interface BundleItem {
  componentSku: string
  componentName: string
  quantity: number
}

interface InlineMappingDialogProps {
  open: boolean
  marketplaceId: string
  items: OrderItem[]
  onClose: () => void
  onSaved: () => void
}

export function InlineMappingDialog({
  open,
  marketplaceId,
  items,
  onClose,
  onSaved,
}: InlineMappingDialogProps) {
  const [mappings, setMappings] = useState<Record<string, ProductSearchResult | null>>({})
  const [mappingQty, setMappingQty] = useState<Record<string, number>>({})
  const [bundleItems, setBundleItems] = useState<Record<string, BundleItem[]>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setMappings({})
      setMappingQty({})
      setBundleItems({})
    }
  }, [open])

  if (!open) return null

  const handleSelectProduct = async (itemKey: string, product: ProductSearchResult) => {
    setMappings((prev) => ({ ...prev, [itemKey]: product }))
    try {
      const res = await fetch(`/api/products/bundles/${encodeURIComponent(product.internalSku)}`)
      if (res.ok) {
        const data = await res.json()
        // existing bundle items don't have componentName, enrich them
        const enriched: BundleItem[] = (data.items ?? []).map((i: { componentSku: string; quantity: number }) => ({
          componentSku: i.componentSku,
          componentName: i.componentSku,
          quantity: i.quantity,
        }))
        setBundleItems((prev) => ({ ...prev, [itemKey]: enriched }))
      }
    } catch { /* ignore */ }
  }

  const addBundleItem = (itemKey: string) => {
    setBundleItems((prev) => ({
      ...prev,
      [itemKey]: [...(prev[itemKey] ?? []), { componentSku: '', componentName: '', quantity: 1 }],
    }))
  }

  const updateBundleItem = (itemKey: string, idx: number, product: ProductSearchResult) => {
    setBundleItems((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] ?? []).map((item, i) =>
        i === idx
          ? { ...item, componentSku: product.internalSku, componentName: product.name }
          : item,
      ),
    }))
  }

  const updateBundleQty = (itemKey: string, idx: number, quantity: number) => {
    setBundleItems((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] ?? []).map((item, i) => (i === idx ? { ...item, quantity } : item)),
    }))
  }

  const removeBundleItem = (itemKey: string, idx: number) => {
    setBundleItems((prev) => ({
      ...prev,
      [itemKey]: (prev[itemKey] ?? []).filter((_, i) => i !== idx),
    }))
  }

  const handleSaveAll = async () => {
    const entries = Object.entries(mappings).filter(([, p]) => p !== null) as [string, ProductSearchResult][]
    if (entries.length === 0) {
      toast.error('매핑할 상품을 선택하세요.')
      return
    }
    setSaving(true)
    try {
      // 1. Save productNameMappings
      let success = 0
      let failed = 0
      for (const [marketplaceName, product] of entries) {
        const qty = Math.max(1, mappingQty[marketplaceName] ?? 1)
        const res = await fetch('/api/products/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketplaceId,
            marketplaceName,
            displayName: product.name,
            productId: product.id,
            pickingLocation: product.warehouseLocation,
            quantity: qty,
          }),
        })
        if (res.ok) success++
        else failed++
      }

      // 2. Save bundle items
      const savedSkus = new Set<string>()
      for (const [itemKey, product] of entries) {
        if (savedSkus.has(product.internalSku)) continue
        if (!(itemKey in bundleItems)) continue
        savedSkus.add(product.internalSku)
        const items = (bundleItems[itemKey] ?? []).filter((i) => i.componentSku && i.quantity > 0)
        await fetch(`/api/products/bundles/${encodeURIComponent(product.internalSku)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(items.map((i) => ({ componentSku: i.componentSku, quantity: i.quantity }))),
        })
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
      <div className="w-full max-w-2xl rounded-lg border bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="mb-2 text-lg font-semibold">주문 상품 매핑</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          매핑이 필요한 상품들을 우리 상품과 연결하세요.
        </p>

        <div className="space-y-4">
          {items.map((item, idx) => {
            const itemKey = item.productName
            const selected = mappings[itemKey]
            const bundle = bundleItems[itemKey]
            const hasBundle = bundle !== undefined

            return (
              <div key={`${item.productName}-${idx}`} className="rounded-md border p-3 space-y-2">
                <div>
                  <p className="text-sm font-medium">{item.productName}</p>
                  {item.optionText && (
                    <p className="text-xs text-muted-foreground">{item.optionText}</p>
                  )}
                  <p className="text-xs text-muted-foreground">수량: {item.quantity}</p>
                </div>

                <ProductSearch onSelect={(p) => void handleSelectProduct(itemKey, p)} />

                {selected && (
                  <div className="flex items-center gap-2">
                    <p className="flex-1 truncate text-xs text-green-600">
                      ✓ {selected.internalSku} — {selected.name}
                    </p>
                    <span className="text-xs text-muted-foreground">× 수량</span>
                    <input
                      type="number"
                      min={1}
                      value={mappingQty[itemKey] ?? 1}
                      onChange={(e) =>
                        setMappingQty((prev) => ({
                          ...prev,
                          [itemKey]: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="w-14 rounded border px-2 py-0.5 text-xs text-center"
                      title="이 마켓 상품 1개당 내부 SKU N개 (예: A 2개입 벌크팩 → 2)"
                    />
                  </div>
                )}

                {/* Bundle section */}
                {selected && (
                  <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        세트 구성
                        {hasBundle && bundle.length > 0 && (
                          <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                            {bundle.length}개 구성품
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => addBundleItem(itemKey)}
                        className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                      >
                        + 구성품
                      </button>
                    </div>

                    {!hasBundle || bundle.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        단일 상품 — 세트이면 구성품을 추가하세요
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {bundle.map((comp, cidx) => (
                          <div key={cidx} className="space-y-1">
                            <ProductSearch
                              initialValue={comp.componentSku ? `${comp.componentSku} - ${comp.componentName}` : ''}
                              onSelect={(p) => updateBundleItem(itemKey, cidx, p)}
                            />
                            {comp.componentSku && (
                              <div className="flex items-center gap-2">
                                <p className="text-xs text-green-600 flex-1">
                                  ✓ {comp.componentSku} — {comp.componentName}
                                </p>
                                <input
                                  type="number"
                                  min={1}
                                  value={comp.quantity}
                                  onChange={(e) => updateBundleQty(itemKey, cidx, Number(e.target.value))}
                                  className="w-14 rounded border px-2 py-0.5 text-xs text-center"
                                />
                                <span className="text-xs text-muted-foreground">개</span>
                                <button
                                  type="button"
                                  onClick={() => removeBundleItem(itemKey, cidx)}
                                  className="text-xs text-red-400 hover:text-red-600"
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-muted">
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

function ProductSearch({
  onSelect,
  initialValue = '',
}: {
  onSelect: (p: ProductSearchResult) => void
  initialValue?: string
}) {
  const [query, setQuery] = useState(initialValue)
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
    </div>
  )
}
