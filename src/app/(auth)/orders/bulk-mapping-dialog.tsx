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
  optionHint?: string | null
}

interface BundleItem {
  componentSku: string
  componentName: string
  quantity: number
}

interface UnmappedOption {
  marketplaceId: string
  productName: string
  optionText: string
  orderCount: number
}

interface BulkMappingDialogProps {
  open: boolean
  orders: OrderRow[]
  onClose: () => void
  onSaved: () => void
}

/**
 * 선택한 주문들의 미매핑 상품 옵션들을 중복 제거 후 일괄 매핑.
 * 세트상품이면 선택 즉시 구성품 편집 가능 → 저장 시 번들+매핑 동시 저장.
 */
export function BulkMappingDialog({ open, orders, onClose, onSaved }: BulkMappingDialogProps) {
  // key: `${marketplaceId}::${productName}::${optionText}`
  const [mappings, setMappings] = useState<Record<string, ProductSearchResult | null>>({})
  // bundleItems: key → component list
  const [bundleItems, setBundleItems] = useState<Record<string, BundleItem[]>>({})
  const [saving, setSaving] = useState(false)

  // Deduplicate by (marketplaceId, productName, optionText)
  const unmappedOptions = useMemo<UnmappedOption[]>(() => {
    const map = new Map<string, UnmappedOption>()
    for (const order of orders) {
      if (order.mappingStatus === 'mapped') continue
      for (const item of order.items) {
        const optionText = item.optionText?.trim() ?? ''
        const key = `${order.marketplaceId}::${item.productName}::${optionText}`
        const existing = map.get(key)
        if (existing) existing.orderCount++
        else
          map.set(key, {
            marketplaceId: order.marketplaceId,
            productName: item.productName,
            optionText,
            orderCount: 1,
          })
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const nameCompare = a.productName.localeCompare(b.productName)
      if (nameCompare !== 0) return nameCompare
      return a.optionText.localeCompare(b.optionText)
    })
  }, [orders])

  // Group by (marketplaceId, productName)
  const groupedProducts = useMemo(() => {
    const groups = new Map<
      string,
      { marketplaceId: string; productName: string; options: UnmappedOption[] }
    >()
    for (const opt of unmappedOptions) {
      const gKey = `${opt.marketplaceId}::${opt.productName}`
      const group = groups.get(gKey)
      if (group) group.options.push(opt)
      else groups.set(gKey, { marketplaceId: opt.marketplaceId, productName: opt.productName, options: [opt] })
    }
    return Array.from(groups.values())
  }, [unmappedOptions])

  useEffect(() => {
    if (open) {
      setMappings({})
      setBundleItems({})
    }
  }, [open])

  if (!open) return null

  // When product selected: load existing bundle items for that SKU
  const handleSelect = async (key: string, product: ProductSearchResult) => {
    setMappings((prev) => ({ ...prev, [key]: product }))
    try {
      const res = await fetch(`/api/products/bundles/${encodeURIComponent(product.internalSku)}`)
      if (res.ok) {
        const data = await res.json()
        const enriched: BundleItem[] = (data.items ?? []).map((i: { componentSku: string; quantity: number }) => ({
          componentSku: i.componentSku,
          componentName: i.componentSku,
          quantity: i.quantity,
        }))
        setBundleItems((prev) => ({ ...prev, [key]: enriched }))
      }
    } catch { /* ignore */ }
  }

  const addBundleItem = (key: string) => {
    setBundleItems((prev) => ({
      ...prev,
      [key]: [...(prev[key] ?? []), { componentSku: '', componentName: '', quantity: 1 }],
    }))
  }

  const selectBundleComponent = (key: string, idx: number, product: ProductSearchResult) => {
    setBundleItems((prev) => ({
      ...prev,
      [key]: (prev[key] ?? []).map((item, i) =>
        i === idx ? { ...item, componentSku: product.internalSku, componentName: product.name } : item,
      ),
    }))
  }

  const updateBundleQty = (key: string, idx: number, quantity: number) => {
    setBundleItems((prev) => ({
      ...prev,
      [key]: (prev[key] ?? []).map((item, i) => (i === idx ? { ...item, quantity } : item)),
    }))
  }

  const removeBundleItem = (key: string, idx: number) => {
    setBundleItems((prev) => ({
      ...prev,
      [key]: (prev[key] ?? []).filter((_, i) => i !== idx),
    }))
  }

  const handleSaveAll = async () => {
    const entries = Object.entries(mappings).filter(([, p]) => p !== null) as [
      string,
      ProductSearchResult,
    ][]
    if (entries.length === 0) {
      toast.error('매핑할 상품을 하나 이상 선택하세요.')
      return
    }
    setSaving(true)
    try {
      const optionByKey = new Map(
        unmappedOptions.map((opt) => [
          `${opt.marketplaceId}::${opt.productName}::${opt.optionText}`,
          opt,
        ]),
      )

      // 1. Save productNameMappings
      const savedNameKeys = new Set<string>()
      let nameFailed = 0
      for (const [key, product] of entries) {
        const opt = optionByKey.get(key)!
        const nameKey = `${opt.marketplaceId}::${opt.productName}`
        if (savedNameKeys.has(nameKey)) continue
        savedNameKeys.add(nameKey)
        const res = await fetch('/api/products/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketplaceId: opt.marketplaceId,
            marketplaceName: opt.productName,
            displayName: product.name,
            productId: product.id,
            pickingLocation: product.warehouseLocation,
          }),
        })
        if (!res.ok) nameFailed++
      }

      // 2. Save productOptionMappings
      const optionPayload = entries.map(([key, product]) => {
        const opt = optionByKey.get(key)!
        return {
          marketplaceId: opt.marketplaceId,
          marketplaceName: opt.productName,
          optionText: opt.optionText,
          variantSku: product.internalSku,
          productId: product.id,
        }
      })
      const optRes = await fetch('/api/products/option-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(optionPayload),
      })

      // 3. Save bundle items for each mapped SKU that has components defined
      const savedBundleSkus = new Set<string>()
      for (const [key, product] of entries) {
        if (savedBundleSkus.has(product.internalSku)) continue
        if (key in bundleItems) {
          savedBundleSkus.add(product.internalSku)
          const items = (bundleItems[key] ?? [])
            .filter((i) => i.componentSku && i.quantity > 0)
            .map((i) => ({ componentSku: i.componentSku, quantity: i.quantity }))
          await fetch(`/api/products/bundles/${encodeURIComponent(product.internalSku)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(items),
          })
        }
      }

      // 4. Apply mappings immediately to existing orderItems
      const orderIds = orders.map((o) => o.id)
      await fetch('/api/orders/apply-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      })

      if (optRes.ok) toast.success(`${entries.length}개 옵션 매핑 완료`)
      if (nameFailed > 0) toast.error(`상품명 매핑 ${nameFailed}건 실패`)

      onSaved()
      onClose()
    } catch {
      toast.error('매핑 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const mappedCount = Object.values(mappings).filter(Boolean).length

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-full max-w-3xl rounded-lg border bg-white p-6 shadow-xl max-h-[90vh] flex flex-col">
        <h2 className="mb-2 text-lg font-semibold">일괄 매핑</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          선택한 주문 {orders.length}건 · 미매핑 옵션 {unmappedOptions.length}개 (중복 제외)
        </p>

        {unmappedOptions.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            매핑이 필요한 상품이 없습니다 — 모두 매핑 완료!
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4">
            {groupedProducts.map(({ marketplaceId, productName, options }) => (
              <div key={`${marketplaceId}::${productName}`} className="rounded-md border">
                {/* Product group header */}
                <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
                    {MARKETPLACE_LABELS[marketplaceId] ?? marketplaceId}
                  </span>
                  <span className="text-sm font-medium line-clamp-1">{productName}</span>
                </div>

                {/* Option sub-rows */}
                <div className="divide-y">
                  {options.map((opt) => {
                    const key = `${opt.marketplaceId}::${opt.productName}::${opt.optionText}`
                    const selected = mappings[key]
                    const items = bundleItems[key]
                    const hasBundle = items !== undefined

                    return (
                      <div key={key} className="px-3 py-2.5 space-y-2">
                        {/* Option label + order count */}
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {opt.optionText ? opt.optionText : <span className="italic">(옵션 없음)</span>}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{opt.orderCount}건</span>
                        </div>

                        {/* Product search */}
                        <ProductSearch onSelect={(p) => void handleSelect(key, p)} />

                        {selected && (
                          <p className="text-xs text-green-600">
                            ✓ {selected.internalSku} — {selected.name}
                          </p>
                        )}

                        {/* Bundle section — shown after product selected */}
                        {selected && (
                          <div className="rounded-md border border-dashed px-3 py-2 space-y-2 bg-muted/20">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-muted-foreground">
                                세트 구성
                                {hasBundle && items.length > 0 && (
                                  <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                                    {items.length}개 구성품
                                  </span>
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => addBundleItem(key)}
                                className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                              >
                                + 구성품
                              </button>
                            </div>

                            {!hasBundle || items.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                단일 상품 — 세트이면 구성품을 추가하세요
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {items.map((item, idx) => (
                                  <div key={idx} className="space-y-1">
                                    <ProductSearch
                                      initialValue={item.componentSku ? `${item.componentSku} - ${item.componentName}` : ''}
                                      onSelect={(p) => selectBundleComponent(key, idx, p)}
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
                                          onChange={(e) => updateBundleQty(key, idx, Number(e.target.value))}
                                          className="w-14 rounded border px-2 py-0.5 text-xs text-center"
                                        />
                                        <span className="text-xs text-muted-foreground">개</span>
                                        <button
                                          type="button"
                                          onClick={() => removeBundleItem(key, idx)}
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
              </div>
            ))}
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
            disabled={saving || mappedCount === 0}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? '저장 중...' : `매핑 저장 (${mappedCount}개)`}
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
    if (q.length < 1) {
      setResults([])
      return
    }
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
