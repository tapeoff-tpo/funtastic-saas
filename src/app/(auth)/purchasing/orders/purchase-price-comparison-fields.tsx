'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  purchasePriceDifference,
  purchaseShippingPerUnit,
  type PurchasePriceComparison,
  type PurchasePriceField,
} from '@/lib/purchasing/purchase-price-comparison'

const labels: Record<PurchasePriceField, string> = {
  baselineUnitPriceCny: '기존 구매단가',
  baselineShippingCny: '기존 배송비 합계',
  actualUnitPriceCny: '신규 구매단가',
  actualShippingCny: '신규 배송비 합계',
}
const cny = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 })

export function PurchasePriceComparisonFields({ id, prices, quantity, canEditBaseline, canEditActual }: {
  id: string
  prices: Required<PurchasePriceComparison>
  quantity: number
  canEditBaseline: boolean
  canEditActual: boolean
}) {
  const router = useRouter()
  const [saved, setSaved] = useState(prices)
  const [draft, setDraft] = useState(prices)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const unitDifference = purchasePriceDifference(draft.actualUnitPriceCny, draft.baselineUnitPriceCny)
  const shippingDifference = purchasePriceDifference(draft.actualShippingCny, draft.baselineShippingCny)
  const keys = Object.keys(labels) as PurchasePriceField[]
  const changed = keys.filter((key) => draft[key] !== saved[key])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || changed.length === 0) return
    setSaving(true)
    setMessage('')
    try {
      const purchasePriceComparison = Object.fromEntries(changed.map((key) => [key, draft[key]]))
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchasePriceComparison }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        setMessage(body.error ?? '저장 실패')
        return
      }
      setSaved(draft)
      setMessage('저장됨')
      router.refresh()
    } catch {
      setMessage('저장 실패')
    } finally {
      setSaving(false)
    }
  }

  function field(key: PurchasePriceField) {
    const editable = key.startsWith('baseline') ? canEditBaseline : canEditActual
    return (
      <label className="grid min-w-0 gap-1 text-xs">
        <span className="whitespace-nowrap text-muted-foreground">{labels[key]}</span>
        {editable ? (
          <input
            type="number"
            min="0"
            max="999999999"
            step="0.01"
            inputMode="decimal"
            value={draft[key] ?? ''}
            disabled={saving}
            placeholder="–"
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber
              setDraft((current) => ({ ...current, [key]: Number.isFinite(value) ? value : null }))
              setMessage('')
            }}
            className="h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-right tabular-nums"
          />
        ) : <span className="flex h-7 items-center justify-end px-2 tabular-nums">{draft[key] === null ? '–' : cny.format(draft[key])}</span>}
      </label>
    )
  }

  function perUnit(shipping: number | null) {
    const amount = purchaseShippingPerUnit(shipping, quantity)
    return amount === null ? '–' : `¥${cny.format(amount)}`
  }

  return (
    <form onSubmit={save} className="grid min-w-[300px] gap-1.5">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {field('baselineUnitPriceCny')}
        {field('baselineShippingCny')}
        {field('actualUnitPriceCny')}
        {field('actualShippingCny')}
      </div>
      <div className="flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
        <span>개당 배송비</span>
        <span data-no-translate>{perUnit(draft.baselineShippingCny)} → {perUnit(draft.actualShippingCny)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <PriceDifference label="단가 차이" amount={unitDifference} />
        <PriceDifference label="배송비 차이" amount={shippingDifference} />
        {canEditBaseline && <Button type="submit" variant="outline" size="xs" className="ml-auto" disabled={saving || changed.length === 0}>{saving ? '저장 중' : '저장'}</Button>}
        <span role="status" className="text-xs text-muted-foreground">{message}</span>
      </div>
    </form>
  )
}

function PriceDifference({ label, amount }: { label: string; amount: number | null }) {
  if (amount === null) return null
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] ${amount > 0 ? 'bg-red-100 font-medium text-red-800' : 'bg-muted text-muted-foreground'}`}>
      <span>{label}</span>{' '}
      <span data-no-translate>{amount > 0 ? '+' : ''}{cny.format(amount)} 元</span>
    </span>
  )
}
