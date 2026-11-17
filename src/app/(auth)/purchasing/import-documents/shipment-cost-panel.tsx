'use client'

import { useState } from 'react'
import { calculateShipmentCost } from '@/lib/purchasing/shipment-cost'
import type { ImportDocumentDetail } from '@/lib/purchasing/china-import-document'

const won = (amount: number) => amount.toLocaleString('ko-KR', { maximumFractionDigits: 2 })

export function ShipmentCostPanel({ packing, prices, url, snapshot }: {
  url: string
  snapshot: string
  packing: ImportDocumentDetail
  prices: Record<string, string>
}) {
  const [mixed, setMixed] = useState<Record<string, number>>({})
  const [preview, setPreview] = useState<{ result: ReturnType<typeof calculateShipmentCost>; inputs: Parameters<typeof calculateShipmentCost>[1]; prices: string; billedCbm: number | null }>()
  const priceSnapshot = JSON.stringify(prices)
  const result = preview?.prices === priceSnapshot ? preview.result : undefined
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const items = new Map(packing.items.map((item) => [item.id, item.sku]))
  const mixedBoxes = packing.boxes.flatMap((box) => {
    const lines = packing.boxItems.filter((line) => line.boxId === box.id)
    return lines.length > 1 ? [{ box, lines }] : []
  })
  return <section className="space-y-3 rounded-lg border bg-background p-4">
    <h2 className="font-semibold">회차 원가 계산</h2>
    <form className="space-y-3" onChange={() => setPreview(undefined)} onSubmit={(event) => {
      event.preventDefault()
      setError('')
      setPreview(undefined)
      const form = new FormData(event.currentTarget)
      try {
        const inputs = {
          charges: Number(form.get('charges')), vat: Number(form.get('vat')), exchangeRate: Number(form.get('rate')),
          prices: Object.fromEntries(Object.entries(prices).filter(([, amount]) => amount.trim()).map(([id, amount]) => [id, Number(amount)])),
          mixedBoxCbm: mixed,
        }
        const result = calculateShipmentCost(packing, inputs)
        const billedCbm = Number(form.get('billedCbm')) || null
        setPreview({ result, inputs, prices: priceSnapshot, billedCbm })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '원가를 계산하지 못했습니다.')
      }
    }}>
      <div className="grid gap-3 sm:grid-cols-4">
        {([['charges', '운송사 총 청구액 (원)', '1'], ['vat', '공제 부가세 (원)', '1'], ['rate', '상품 매입 환율 (원/CNY)', 'any'], ['billedCbm', '인보이스 청구 CBM', 'any']] as const).map(([name, label, step]) =>
          <label key={name} className="grid gap-1 text-sm">{label}
            <input name={name} type="number" required={name !== 'billedCbm'} min={name === 'rate' || name === 'billedCbm' ? '0.0001' : '0'} step={step} className="rounded border bg-background px-2 py-1.5" />
          </label>
        )}
      </div>
      {mixedBoxes.map(({ box, lines }) => <fieldset key={box.id} className="flex flex-wrap gap-2 rounded border p-2">
        <legend className="px-1 text-sm">{box.boxNo} 혼적 박스 · SKU별 합산 부피 (CBM)</legend>
        {lines.map((line) => <label className="grid gap-1 text-xs" key={line.id}>{items.get(line.shipmentItemId)} · {line.quantity}개
          <input type="number" required min="0.000001" step="any" className="w-32 rounded border bg-background p-1"
            onChange={(event) => setMixed((current) => ({ ...current, [line.id]: event.target.valueAsNumber }))} />
        </label>)}
      </fieldset>)}
      <button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">원가 미리 계산</button>
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <>
      <p className="text-sm">패킹리스트 {result.cbm.toFixed(4)} CBM · 배분 비용 {won(result.distributable)}원</p>
      {preview?.billedCbm != null && (
        <p className="text-sm">인보이스 {preview.billedCbm.toFixed(4)} CBM · 차이 {(result.cbm - preview.billedCbm).toFixed(4)} CBM</p>
      )}
      <div className="overflow-auto"><table className="w-full whitespace-nowrap text-left text-sm">
        <thead className="bg-muted"><tr>{['품목', '수량', '배분 CBM', '상품 매입액', '배분 부대비용', '단위원가'].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{result.rows.map((row) => <tr key={row.sku} className="border-t">
          <td className="p-2">{row.sku} · {row.name}</td><td className="p-2">{row.quantity}</td><td className="p-2">{row.cbm.toFixed(4)}</td>
          <td className="p-2">{won(row.goods)}원</td><td className="p-2">{won(row.allocated)}원</td><td className="p-2">{won(row.unitCost)}원</td>
        </tr>)}</tbody>
      </table></div>
      {saved ? <p role="status" className="text-sm">회차 원가를 확정했습니다. 품목리스트에서 확인할 수 있습니다.</p> :
        <form className="flex flex-wrap items-end gap-2" onSubmit={async (event) => {
          event.preventDefault()
          if (!preview || saving) return
          const form = new FormData(event.currentTarget)
          setSaving(true)
          setError('')
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ intent: 'confirm-cost', snapshot, bl: form.get('bl'), date: form.get('date'), inputs: preview.inputs }),
            })
            if (!response.ok) throw new Error((await response.json()).error || '회차 원가를 저장하지 못했습니다.')
            setSaved(true)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '회차 원가를 저장하지 못했습니다.')
          } finally {
            setSaving(false)
          }
        }}>
          <label className="grid gap-1 text-sm">B/L 번호<input name="bl" required maxLength={500} className="rounded border bg-background p-2" /></label>
          <label className="grid gap-1 text-sm">원가 기준일<input name="date" type="date" required className="rounded border bg-background p-2" /></label>
          <button type="submit" disabled={saving} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">회차 원가 확정</button>
        </form>}

    </>}
  </section>
}
