'use client'

import { type FormEvent, type ReactNode, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Loader2, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  adjustSaasChinaInventoryAction,
  receiveSaasChinaInventoryAction,
} from '../saas-china-actions'

export type SaasChinaInventoryViewItem = {
  id: string
  warehouseCode: string
  sku: string
  productName: string
  optionName: string | null
  onHandQuantity: number
  reservedQuantity: number
  availableQuantity: number
  lastReceivedAt: string | null
  lastOutboundAt: string | null
}

type Summary = {
  onHandQuantity: number
  reservedQuantity: number
  availableQuantity: number
}

const emptyReceiveForm = {
  warehouseCode: '중국창고',
  sku: '',
  productName: '',
  optionName: '',
  quantity: '',
  note: '',
}

export function SaasChinaInventoryBoard({ items, summary }: { items: SaasChinaInventoryViewItem[]; summary: Summary }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showReceive, setShowReceive] = useState(items.length === 0)
  const [receiveForm, setReceiveForm] = useState(emptyReceiveForm)
  const [adjusting, setAdjusting] = useState<SaasChinaInventoryViewItem | null>(null)
  const [adjustDelta, setAdjustDelta] = useState('')
  const [adjustNote, setAdjustNote] = useState('')
  const [search, setSearch] = useState('')

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('ko-KR')
    if (!keyword) return items
    return items.filter((item) => (
      [item.warehouseCode, item.sku, item.productName, item.optionName ?? '']
        .some((value) => value.toLocaleLowerCase('ko-KR').includes(keyword))
    ))
  }, [items, search])

  function receiveStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await receiveSaasChinaInventoryAction({
        ...receiveForm,
        quantity: Number(receiveForm.quantity),
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('SaaS 중국재고에 테스트 입고를 반영했습니다.')
      setReceiveForm(emptyReceiveForm)
      setShowReceive(false)
      router.refresh()
    })
  }

  function adjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!adjusting) return
    startTransition(async () => {
      const result = await adjustSaasChinaInventoryAction({
        inventoryId: adjusting.id,
        delta: Number(adjustDelta),
        note: adjustNote,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('SaaS 중국재고 수량을 조정했습니다.')
      setAdjusting(null)
      setAdjustDelta('')
      setAdjustNote('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4" aria-busy={isPending}>
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="현재고" value={summary.onHandQuantity} description="SaaS 재고 장부 기준" />
        <SummaryCard label="출고 예약" value={summary.reservedQuantity} description="초안·포장 작업에 잡힌 수량" />
        <SummaryCard label="작업 가능" value={summary.availableQuantity} description="새 출고작업에 선택할 수 있는 수량" emphasis />
      </section>

      <section className="rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">테스트 재고 입고</h2>
            <p className="mt-1 text-xs text-muted-foreground">실제 Ecount 중국재고에는 영향을 주지 않습니다.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowReceive((open) => !open)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            <Plus className="size-4" />
            {showReceive ? '입고 입력 닫기' : '테스트 재고 추가'}
          </button>
        </div>
        {showReceive ? (
          <form onSubmit={receiveStock} className="grid gap-3 p-4 md:grid-cols-6">
            <Field label="중국창고">
              <input value={receiveForm.warehouseCode} onChange={(event) => setReceiveForm((form) => ({ ...form, warehouseCode: event.target.value }))} required className={inputClass} placeholder="예: 중국창고 A" />
            </Field>
            <Field label="품목코드">
              <input value={receiveForm.sku} onChange={(event) => setReceiveForm((form) => ({ ...form, sku: event.target.value }))} required className={inputClass} placeholder="SKU" />
            </Field>
            <Field label="상품명">
              <input value={receiveForm.productName} onChange={(event) => setReceiveForm((form) => ({ ...form, productName: event.target.value }))} required className={inputClass} placeholder="테스트 상품" />
            </Field>
            <Field label="옵션명">
              <input value={receiveForm.optionName} onChange={(event) => setReceiveForm((form) => ({ ...form, optionName: event.target.value }))} className={inputClass} placeholder="선택" />
            </Field>
            <Field label="입고 수량">
              <input type="number" min="1" step="1" value={receiveForm.quantity} onChange={(event) => setReceiveForm((form) => ({ ...form, quantity: event.target.value }))} required className={inputClass} placeholder="0" />
            </Field>
            <div className="flex items-end">
              <button type="submit" disabled={isPending} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Box className="size-4" />}
                입고 반영
              </button>
            </div>
            <label className="md:col-span-6">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">메모</span>
              <input value={receiveForm.note} onChange={(event) => setReceiveForm((form) => ({ ...form, note: event.target.value }))} className={inputClass} placeholder="테스트 목적, 도착일 등" />
            </label>
          </form>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">SaaS 중국재고 목록</h2>
            <p className="mt-1 text-xs text-muted-foreground">총 {items.length.toLocaleString('ko-KR')}개 재고 항목</p>
          </div>
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm sm:w-64" placeholder="창고, SKU, 상품, 옵션 검색" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">중국창고</th>
                <th className="px-3 py-2 font-medium">품목</th>
                <th className="px-3 py-2 text-right font-medium">현재고</th>
                <th className="px-3 py-2 text-right font-medium">출고 예약</th>
                <th className="px-3 py-2 text-right font-medium">작업 가능</th>
                <th className="px-3 py-2 font-medium">최근 입고</th>
                <th className="px-3 py-2 text-center font-medium">작업</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-16 text-center text-sm text-muted-foreground">등록된 SaaS 중국재고가 없습니다. 위에서 테스트 재고를 먼저 추가해주세요.</td></tr>
              ) : filteredItems.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{item.warehouseCode}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.productName}</div>
                    <div className="text-xs text-muted-foreground">{item.sku}{item.optionName ? ` · ${item.optionName}` : ''}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.onHandQuantity.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">{item.reservedQuantity.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">{item.availableQuantity.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(item.lastReceivedAt)}</td>
                  <td className="px-3 py-2 text-center">
                    <button type="button" onClick={() => { setAdjusting(item); setAdjustDelta(''); setAdjustNote('') }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-muted">
                      <Pencil className="size-3" /> 수량 조정
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {adjusting ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={adjustStock} className="w-full max-w-md rounded-lg bg-background p-5 shadow-xl">
            <h3 className="text-lg font-semibold">SaaS 중국재고 수량 조정</h3>
            <p className="mt-1 text-sm text-muted-foreground">{adjusting.sku} · 현재고 {adjusting.onHandQuantity.toLocaleString('ko-KR')}개 · 예약 {adjusting.reservedQuantity.toLocaleString('ko-KR')}개</p>
            <div className="mt-4 space-y-3">
              <Field label="조정 수량">
                <input autoFocus type="number" step="1" value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} required className={inputClass} placeholder="예: 20 또는 -5" />
              </Field>
              <Field label="메모">
                <input value={adjustNote} onChange={(event) => setAdjustNote(event.target.value)} className={inputClass} placeholder="수량 조정 사유" />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setAdjusting(null)} className="h-9 rounded-md border px-3 text-sm hover:bg-muted">취소</button>
              <button type="submit" disabled={isPending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                {isPending ? <Loader2 className="size-4 animate-spin" /> : null} 조정 반영
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

function SummaryCard({ label, value, description, emphasis = false }: { label: string; value: number; description: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${emphasis ? 'border-emerald-200 bg-emerald-50/50' : 'bg-card'}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${emphasis ? 'text-emerald-700' : ''}`}>{value.toLocaleString('ko-KR')}개</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date)
}

const inputClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30'
