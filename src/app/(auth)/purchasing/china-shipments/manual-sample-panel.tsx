'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { addChinaOutboundSampleAction } from '../saas-china-actions'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'

const inputClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm'

export function ManualSamplePanel({ shipmentId, defaultWarehouseCode, warehouseCodes, editable, isPending }: {
  shipmentId: string; defaultWarehouseCode: string; warehouseCodes: string[]; editable: boolean; isPending: boolean
}) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [productName, setProductName] = useState('')
  const [chineseProductName, setChineseProductName] = useState('')
  const [optionName, setOptionName] = useState('')
  const [quantity, setQuantity] = useState('')
  const initialWarehouse = warehouseCodes.includes(defaultWarehouseCode) ? defaultWarehouseCode : warehouseCodes[0] || '중국창고'
  const [warehouseCode, setWarehouseCode] = useState(initialWarehouse)
  const [note, setNote] = useState('')
  // Retain the same key and payload after an ambiguous network failure.
  const attempt = useRef<{ requestId: string; productName: string; chineseProductName: string; optionName: string; quantity: number; warehouseCode: string; note: string } | null>(null)
  const [retrying, setRetrying] = useState(false)
  const disabled = !editable || isPending || pending || guard.busy
  function clear() {
    setProductName(''); setChineseProductName(''); setOptionName(''); setQuantity(''); setNote(''); setWarehouseCode(initialWarehouse)
    attempt.current = null; setRetrying(false); setOpen(false)
  }
  async function save() {
    const count = Number(quantity)
    if (!attempt.current && (!productName.trim() || !warehouseCode || !Number.isSafeInteger(count) || count <= 0)) {
      toast.error('상품명과 올바른 샘플 수량을 입력해주세요.'); return false
    }
    attempt.current ??= { requestId: crypto.randomUUID(), productName: productName.trim(), chineseProductName: chineseProductName.trim(), optionName: optionName.trim(), quantity: count, warehouseCode, note: note.trim() }
    try {
      const result = await addChinaOutboundSampleAction({ shipmentId, ...attempt.current })
      if (!result.ok) { attempt.current = null; setRetrying(false); toast.error(result.error); return false }
      guard.setDraft('manual-sample', null); clear(); router.refresh(); toast.success('샘플을 출고품목에 추가했습니다.'); return true
    } catch {
      setRetrying(true); toast.error('등록 결과를 확인하지 못했습니다. 다시 저장하면 중복 없이 확인합니다.'); return false
    }
  }
  useChinaWorkDraft('manual-sample', productName || chineseProductName || optionName || quantity || note || retrying ? {
    kind: 'items', label: '샘플 수기 추가', snapshot: null, save, discard: clear,
  } : null)
  function submit(event: FormEvent) { event.preventDefault(); start(async () => { await guard.runTask(save) }) }
  if (!editable) return null
  return <section className="rounded-lg border bg-background p-3">
    <button type="button" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)} className="h-9 rounded-md border px-3 text-sm font-medium">샘플 수기 추가</button>
    {open && <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-3">
      <label className="text-sm">품목구분<input className={inputClass} value="샘플" readOnly /></label>
      <label className="text-sm">상품명<input required maxLength={1000} className={inputClass} value={productName} disabled={disabled || retrying} onChange={(event) => setProductName(event.target.value)} /></label>
      <label className="text-sm">상품명(중국어)<input data-no-translate maxLength={1000} className={inputClass} value={chineseProductName} disabled={disabled || retrying} onChange={(event) => setChineseProductName(event.target.value)} /></label>
      <label className="text-sm">옵션<input maxLength={200} className={inputClass} value={optionName} disabled={disabled || retrying} onChange={(event) => setOptionName(event.target.value)} /></label>
      <label className="text-sm">수량<input required type="number" min="1" step="1" className={inputClass} value={quantity} disabled={disabled || retrying} onChange={(event) => setQuantity(event.target.value)} /></label>
      <label className="text-sm">출고창고<select className={inputClass} value={warehouseCode} disabled={disabled || retrying} onChange={(event) => setWarehouseCode(event.target.value)}>{[...new Set([initialWarehouse, ...warehouseCodes])].map((code) => <option key={code}>{code}</option>)}</select></label>
      <label className="text-sm">메모<input maxLength={2000} className={inputClass} value={note} disabled={disabled || retrying} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="flex gap-2 sm:col-span-3"><button type="submit" disabled={disabled} className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground">샘플 추가 저장</button><button type="button" disabled={disabled || retrying} onClick={clear} className="h-9 rounded-md border px-3 text-sm">입력 취소</button></div>
    </form>}
  </section>
}
