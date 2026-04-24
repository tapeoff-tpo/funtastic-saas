'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'

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

interface BundleEditorDialogProps {
  sku: string
  productName: string
  onClose: () => void
}

export function BundleEditorDialog({ sku, productName, onClose }: BundleEditorDialogProps) {
  const [items, setItems] = useState<BundleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/products/bundles/${encodeURIComponent(sku)}`)
      .then((r) => r.json())
      .then((d) =>
        setItems(
          (d.items ?? []).map((i: { componentSku: string; quantity: number }) => ({
            componentSku: i.componentSku,
            componentName: i.componentSku,
            quantity: i.quantity,
          })),
        ),
      )
      .catch(() => toast.error('세트 구성 로드 실패'))
      .finally(() => setLoading(false))
  }, [sku])

  const addItem = () =>
    setItems((prev) => [...prev, { componentSku: '', componentName: '', quantity: 1 }])

  const selectComponent = (idx: number, product: ProductSearchResult) => {
    setItems((prev) =>
      prev.map((item, i) =>
        i === idx
          ? { ...item, componentSku: product.internalSku, componentName: product.name }
          : item,
      ),
    )
  }

  const updateQty = (idx: number, quantity: number) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, quantity } : item)))
  }

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx))

  const handleSave = async () => {
    setSaving(true)
    try {
      const valid = items.filter((i) => i.componentSku && i.quantity > 0)
      const res = await fetch(`/api/products/bundles/${encodeURIComponent(sku)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(valid.map((i) => ({ componentSku: i.componentSku, quantity: i.quantity }))),
      })
      if (res.ok) {
        toast.success(valid.length > 0 ? `세트 구성 저장 (${valid.length}개 구성품)` : '세트 구성 해제')
        onClose()
      } else {
        toast.error('저장 실패')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">세트 구성</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-mono">{sku}</span> — {productName}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">
            ✕
          </button>
        </div>

        <div className="p-5 space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-4">로딩 중...</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                출고 시 아래 구성품 재고가 각각 차감됩니다. 비워두면 단일 상품으로 처리됩니다.
              </p>

              {items.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                  구성품 없음 — 단일 상품
                </p>
              ) : (
                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <div key={idx} className="space-y-1.5">
                      <ProductSearch
                        initialValue={item.componentSku ? `${item.componentSku} - ${item.componentName}` : ''}
                        onSelect={(p) => selectComponent(idx, p)}
                      />
                      {item.componentSku && (
                        <div className="flex items-center gap-2 pl-1">
                          <p className="flex-1 text-xs text-green-600 truncate">
                            ✓ {item.componentSku} — {item.componentName}
                          </p>
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateQty(idx, Number(e.target.value))}
                            className="w-14 rounded border px-2 py-0.5 text-xs text-center"
                          />
                          <span className="text-xs text-muted-foreground">개</span>
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={addItem}
                className="w-full rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                + 구성품 추가
              </button>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-muted">
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
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
        placeholder="구성품 검색 (상품코드 또는 상품명)"
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
