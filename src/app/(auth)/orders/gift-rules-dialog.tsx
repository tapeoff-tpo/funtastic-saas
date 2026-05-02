'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Search, X } from 'lucide-react'

interface ProductSearchResult {
  id: string
  internalSku: string
  name: string
  optionName: string | null
  optionHint: string | null
  availableStock: number | null
}

interface GiftRule {
  id: string
  name: string
  marketplaceId: string | null
  conditionType: 'amount' | 'sku'
  minAmount: string | null
  triggerSku: string | null
  giftSku: string
  giftQuantity: number
  isActive: boolean
  giftProductName: string | null
  giftOptionName: string | null
}

interface GiftRulesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MARKETPLACE_OPTIONS = [
  { value: '', label: '모든 쇼핑몰' },
  { value: 'coupang', label: '쿠팡' },
  { value: 'naver', label: '네이버' },
  { value: 'gmarket', label: 'G마켓' },
  { value: 'auction', label: '옥션' },
  { value: '11st', label: '11번가' },
  { value: 'cafe24', label: 'Cafe24' },
  { value: 'toss-shopping', label: '토스쇼핑' },
  { value: 'ohouse', label: '오늘의집' },
  { value: 'ownerclan', label: '오너클랜' },
]

export function GiftRulesDialog({ open, onOpenChange }: GiftRulesDialogProps) {
  const [rules, setRules] = useState<GiftRule[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [marketplaceId, setMarketplaceId] = useState('')
  const [conditionType, setConditionType] = useState<'amount' | 'sku'>('amount')
  const [minAmount, setMinAmount] = useState('')
  const [triggerSku, setTriggerSku] = useState('')
  const [giftSku, setGiftSku] = useState('')
  const [giftName, setGiftName] = useState('')
  const [giftQuantity, setGiftQuantity] = useState(1)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    void loadRules()
  }, [open])

  async function loadRules() {
    setLoading(true)
    try {
      const res = await fetch('/api/orders/gift-rules')
      if (!res.ok) throw new Error('사은품 규칙을 불러오지 못했습니다.')
      const data = await res.json() as { rules: GiftRule[] }
      setRules(data.rules ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '사은품 규칙 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  async function searchProducts(value: string) {
    const q = value.trim()
    if (q.length < 1) {
      setResults([])
      return
    }
    const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&mode=option`)
    if (!res.ok) return
    const data = await res.json() as { results: ProductSearchResult[] }
    setResults(data.results ?? [])
  }

  function handleSearch(value: string) {
    setQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void searchProducts(value), 250)
  }

  function selectGift(product: ProductSearchResult) {
    setGiftSku(product.internalSku)
    setGiftName(`${product.name}${product.optionName ? ` / ${product.optionName}` : ''}`)
    setQuery('')
    setResults([])
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('규칙명을 입력하세요.')
      return
    }
    if (conditionType === 'amount' && Number(minAmount) <= 0) {
      toast.error('금액 조건을 입력하세요.')
      return
    }
    if (conditionType === 'sku' && !triggerSku.trim()) {
      toast.error('품번코드를 입력하세요.')
      return
    }
    if (!giftSku) {
      toast.error('사은품을 선택하세요.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/orders/gift-rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          marketplaceId: marketplaceId || null,
          conditionType,
          minAmount: conditionType === 'amount' ? minAmount : null,
          triggerSku: conditionType === 'sku' ? triggerSku.trim() : null,
          giftSku,
          giftQuantity,
        }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? '저장 실패')
        return
      }
      toast.success('사은품 규칙 저장 완료')
      setName('')
      setMinAmount('')
      setTriggerSku('')
      setGiftSku('')
      setGiftName('')
      setGiftQuantity(1)
      await loadRules()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('이 사은품 규칙을 삭제하시겠습니까?')) return
    const res = await fetch(`/api/orders/gift-rules/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('삭제 실패')
      return
    }
    toast.success('삭제 완료')
    await loadRules()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-lg font-semibold">사은품 설정</h2>
          <button type="button" onClick={() => onOpenChange(false)} className="rounded p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid max-h-[calc(90vh-56px)] grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[360px_1fr]">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 text-xs font-medium text-muted-foreground">
                규칙명
                <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm" />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                쇼핑몰
                <select value={marketplaceId} onChange={(e) => setMarketplaceId(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm">
                  {MARKETPLACE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                조건
                <select value={conditionType} onChange={(e) => setConditionType(e.target.value as 'amount' | 'sku')} className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm">
                  <option value="amount">상품금액 이상</option>
                  <option value="sku">내부 품번코드 포함</option>
                </select>
              </label>
            </div>

            {conditionType === 'amount' ? (
              <label className="block text-xs font-medium text-muted-foreground">
                상품금액 (배송비 제외)
                <input type="number" min={0} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm" placeholder="예: 30000" />
              </label>
            ) : (
              <label className="block text-xs font-medium text-muted-foreground">
                내부 품번코드
                <input value={triggerSku} onChange={(e) => setTriggerSku(e.target.value)} className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm" placeholder="예: 111700" />
              </label>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">
                사은품 검색
                <div className="mt-1 flex items-center gap-1">
                  <input value={query} onChange={(e) => handleSearch(e.target.value)} className="w-full rounded-md border px-3 py-1.5 text-sm" placeholder="SKU 또는 상품명" />
                  <button type="button" onClick={() => void searchProducts(query)} className="rounded-md border px-2.5 py-1.5 hover:bg-muted">
                    <Search className="h-4 w-4" />
                  </button>
                </div>
              </label>
              {results.length > 0 && (
                <div className="max-h-36 overflow-y-auto rounded-md border">
                  {results.map((product) => (
                    <button key={product.internalSku} type="button" onClick={() => selectGift(product)} className="block w-full border-b px-3 py-2 text-left text-xs hover:bg-muted">
                      <div className="font-medium">{product.name}</div>
                      <div className="text-muted-foreground">{product.internalSku}{product.optionName ? ` · ${product.optionName}` : ''} · 재고 {product.availableStock ?? '-'}</div>
                    </button>
                  ))}
                </div>
              )}
              {giftSku && (
                <div className="rounded-md bg-muted px-3 py-2 text-xs">
                  <div className="font-medium">{giftName || giftSku}</div>
                  <div className="font-mono text-muted-foreground">{giftSku}</div>
                </div>
              )}
            </div>

            <label className="block text-xs font-medium text-muted-foreground">
              사은품 수량
              <input type="number" min={1} value={giftQuantity} onChange={(e) => setGiftQuantity(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded-md border px-3 py-1.5 text-sm" />
            </label>

            <button type="button" onClick={() => void handleSave()} disabled={saving} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? '저장 중...' : '규칙 저장'}
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">등록된 규칙</div>
            {loading && <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">불러오는 중...</div>}
            {!loading && rules.length === 0 && <div className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">등록된 사은품 규칙이 없습니다.</div>}
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{rule.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {rule.marketplaceId ?? '모든 쇼핑몰'} · {rule.conditionType === 'amount' ? `상품금액 ${Number(rule.minAmount ?? 0).toLocaleString('ko-KR')}원 이상` : `내부 품번 ${rule.triggerSku}`}
                    </div>
                    <div className="mt-1 text-xs">
                      사은품: {rule.giftProductName ?? rule.giftSku}{rule.giftOptionName ? ` / ${rule.giftOptionName}` : ''} × {rule.giftQuantity}
                    </div>
                  </div>
                  <button type="button" onClick={() => void handleDelete(rule.id)} className="rounded-md border px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
