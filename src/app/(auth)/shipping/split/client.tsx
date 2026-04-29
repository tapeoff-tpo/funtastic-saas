'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CARRIERS } from '@/lib/shipping/carrier-codes'

interface OrderItem {
  id: string
  productName: string
  optionText: string | null
  quantity: number
  sku: string | null
}

interface OrderPreview {
  id: string
  marketplaceOrderId: string
  buyerName: string
  recipientName: string
  recipientPhone: string | null
  items: OrderItem[]
}

interface ShipmentEntry {
  id: string // client-side only
  carrierId: string
  carrierName: string
  trackingNumber: string
}

function randomClientId() {
  return Math.random().toString(36).slice(2, 10)
}

function newEntry(): ShipmentEntry {
  return {
    id: randomClientId(),
    carrierId: CARRIERS[0].code,
    carrierName: CARRIERS[0].koreanName,
    trackingNumber: '',
  }
}

export function SplitShippingClient() {
  const [orderQuery, setOrderQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [order, setOrder] = useState<OrderPreview | null>(null)
  const [entries, setEntries] = useState<ShipmentEntry[]>([newEntry(), newEntry()])
  const [saving, setSaving] = useState(false)

  const handleSearch = async () => {
    const q = orderQuery.trim()
    if (!q) {
      toast.error('마켓 주문번호 또는 내부 주문번호를 입력하세요')
      return
    }
    setSearching(true)
    try {
      const params = new URLSearchParams({ q })
      const res = await fetch(`/api/orders/lookup?${params.toString()}`)
      if (!res.ok) {
        const text = await res.text()
        toast.error(`조회 실패: ${text.slice(0, 200)}`)
        return
      }
      const data: OrderPreview = await res.json()
      setOrder(data)
      setEntries([newEntry(), newEntry()])
    } catch (err) {
      toast.error(`조회 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSearching(false)
    }
  }

  const updateEntry = (id: string, patch: Partial<ShipmentEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const handleCarrierChange = (id: string, carrierId: string) => {
    const c = CARRIERS.find((c) => c.code === carrierId)
    if (!c) return
    updateEntry(id, { carrierId: c.code, carrierName: c.koreanName })
  }

  const addEntry = () => setEntries((prev) => [...prev, newEntry()])
  const removeEntry = (id: string) =>
    setEntries((prev) => (prev.length <= 1 ? prev : prev.filter((e) => e.id !== id)))

  const handleSave = async () => {
    if (!order) return
    const filled = entries.filter((e) => e.trackingNumber.trim() !== '')
    if (filled.length < 2) {
      toast.error('송장을 2개 이상 입력하세요 (1개는 분리출고가 아닙니다)')
      return
    }
    const nums = filled.map((e) => e.trackingNumber.trim())
    if (new Set(nums).size !== nums.length) {
      toast.error('송장번호 중복')
      return
    }

    if (!window.confirm(`주문을 ${filled.length}개 송장으로 분리 출고합니다. 계속하시겠습니까?`)) return

    setSaving(true)
    try {
      const res = await fetch('/api/shipping/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          shipments: filled.map((e) => ({
            trackingNumber: e.trackingNumber.trim(),
            carrierId: e.carrierId,
            carrierName: e.carrierName,
          })),
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        toast.error(`저장 실패: ${text.slice(0, 200)}`)
        return
      }
      const data = await res.json()
      toast.success(`${data.created}개 송장 등록 완료`)
      setOrder(null)
      setOrderQuery('')
      setEntries([newEntry(), newEntry()])
    } catch (err) {
      toast.error(`저장 실패: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Order lookup */}
      <div className="rounded-lg border bg-white p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={orderQuery}
            onChange={(e) => setOrderQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearch()
            }}
            placeholder="마켓 주문번호 또는 내부 주문번호"
            className="flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={searching}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {searching ? '조회 중...' : '조회'}
          </button>
        </div>
      </div>

      {/* Order preview */}
      {order && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">마켓 주문번호</div>
              <div className="font-mono">{order.marketplaceOrderId}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">주문자</div>
              <div>{order.buyerName}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">수령인</div>
              <div>
                {order.recipientName}
                {order.recipientPhone && (
                  <span className="ml-2 text-xs text-muted-foreground">{order.recipientPhone}</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">주문 상품</div>
            <ul className="space-y-1 text-sm">
              {order.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-2">
                  <span className="flex-1">
                    {item.productName}
                    {item.optionText && (
                      <span className="ml-2 text-xs text-muted-foreground">({item.optionText})</span>
                    )}
                    {item.sku && <span className="ml-2 font-mono text-xs">{item.sku}</span>}
                  </span>
                  <span className="text-muted-foreground">×{item.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Shipment entries */}
      {order && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">송장 입력 ({entries.length})</h3>
            <button
              type="button"
              onClick={addEntry}
              className="rounded-md border px-3 py-1 text-xs hover:bg-muted"
            >
              + 송장 추가
            </button>
          </div>

          <div className="space-y-2">
            {entries.map((entry, idx) => (
              <div key={entry.id} className="flex items-center gap-2">
                <span className="w-8 text-center text-sm text-muted-foreground">#{idx + 1}</span>
                <select
                  value={entry.carrierId}
                  onChange={(e) => handleCarrierChange(entry.id, e.target.value)}
                  className="rounded-md border px-2 py-1.5 text-sm"
                >
                  {CARRIERS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.koreanName}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={entry.trackingNumber}
                  onChange={(e) => updateEntry(entry.id, { trackingNumber: e.target.value })}
                  placeholder="송장번호"
                  className="flex-1 rounded-md border px-3 py-1.5 text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  disabled={entries.length <= 1}
                  className="rounded-md border px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-30"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? '저장 중...' : '분리 출고 저장'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
