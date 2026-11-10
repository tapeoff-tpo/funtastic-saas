'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import {
  purchasePriceDifference,
  purchaseShippingPerUnit,
  type PurchasePriceComparison,
  type PurchasePriceField,
} from '@/lib/purchasing/purchase-price-comparison'

const labels: Record<PurchasePriceField, string> = {
  baselineUnitPriceCny: '기존 구매단가',
  baselineUnitShippingCny: '기존 개당 배송비',
  actualUnitPriceCny: '신규 구매단가',
  actualShippingCny: '신규 배송비 합계',
}
const cny = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 })

export function PurchasePriceComparisonFields({ id, productName, sku, prices, quantity, canEditActual }: {
  id: string
  productName: string
  sku: string
  prices: Required<PurchasePriceComparison>
  quantity: number
  canEditActual: boolean
}) {
  const router = useRouter()
  const [saved, setSaved] = useState(prices)
  const [draft, setDraft] = useState(prices)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const unitDifference = purchasePriceDifference(draft.actualUnitPriceCny, draft.baselineUnitPriceCny)
  const actualUnitShipping = purchaseShippingPerUnit(draft.actualShippingCny, quantity)
  const shippingDifference = purchasePriceDifference(actualUnitShipping, draft.baselineUnitShippingCny, 4)
  const savedUnitShipping = purchaseShippingPerUnit(saved.actualShippingCny, quantity)
  const exceedsBaseline = (purchasePriceDifference(saved.actualUnitPriceCny, saved.baselineUnitPriceCny) ?? 0) > 0
    || (purchasePriceDifference(savedUnitShipping, saved.baselineUnitShippingCny, 4) ?? 0) > 0
  const keys = ['actualUnitPriceCny', 'actualShippingCny'] as const
  const changed = keys.filter((key) => draft[key] !== saved[key])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canEditActual || saving || changed.length === 0) return
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
    const editable = canEditActual && (key === 'actualUnitPriceCny' || key === 'actualShippingCny')
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
            className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-right text-sm tabular-nums"
          />
        ) : <span className="flex h-9 items-center justify-end rounded-md bg-muted px-3 text-sm tabular-nums">{draft[key] === null ? '–' : cny.format(draft[key])}</span>}
      </label>
    )
  }

  function formatShipping(amount: number | null) {
    return amount === null ? '–' : `¥${cny.format(amount)}`
  }

  return (
    <Dialog.Root>
      <Dialog.Trigger render={
        <Button type="button" variant="outline" size="sm" className={exceedsBaseline ? 'border-red-200 text-red-700 hover:text-red-800' : undefined} />
      }>
        <span>가격 비교</span>
        {exceedsBaseline && <span className="rounded bg-red-100 px-1 text-[10px]">가격 초과</span>}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-4 shadow-xl sm:p-5">
          <Dialog.Title className="text-base font-semibold">구매가격 비교 (元)</Dialog.Title>
          <Dialog.Description data-no-translate className="mt-1 break-words text-sm text-muted-foreground">
            {productName} · {sku}
          </Dialog.Description>
          <form onSubmit={save} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {field('baselineUnitPriceCny')}
              {field('actualUnitPriceCny')}
              {field('baselineUnitShippingCny')}
              {field('actualShippingCny')}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span>개당 배송비</span>
              <span data-no-translate>{formatShipping(draft.baselineUnitShippingCny)} → {formatShipping(actualUnitShipping)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <PriceDifference label="단가 차이" amount={unitDifference} />
              <PriceDifference label="개당 배송비 차이" amount={shippingDifference} />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              <span role="status" className="mr-auto text-xs text-muted-foreground">{message}</span>
              <Dialog.Close render={<Button type="button" variant="outline" size="sm" />}>닫기</Dialog.Close>
              {canEditActual && <Button type="submit" size="sm" disabled={saving || changed.length === 0}>{saving ? '저장 중' : '저장'}</Button>}
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
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
