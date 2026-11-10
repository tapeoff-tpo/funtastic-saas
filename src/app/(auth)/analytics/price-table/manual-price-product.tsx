'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getPriceTableDisplayColumns } from './price-table-columns'
import { addManualPriceProduct } from './manual-price-actions'

export function ManualPriceProduct({ sheetName }: { sheetName: string }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  return <section className="rounded-md border bg-card">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"><span>＋ 상품 직접 추가</span><span className="text-xs text-muted-foreground">{sheetName} · 엑셀 없이 등록</span></button>
    {open && <form ref={formRef} className="space-y-3 border-t p-3" onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      startTransition(async () => {
        const result = await addManualPriceProduct(form)
        if (result.error) { toast.error(result.error); return }
        toast.success('상품을 추가했습니다.')
        formRef.current?.reset(); setOpen(false)
        router.push(`/analytics/price-table?sheet=${encodeURIComponent(sheetName)}`)
        router.refresh()
      })
    }}>
      <input type="hidden" name="sheetName" value={sheetName} />
      <div className="grid gap-3 sm:grid-cols-3">{[['productCode', '상품코드'], ['productName', '상품명'], ['optionName', '옵션명']].map(([name, label]) => <label key={name} className="space-y-1 text-xs">{label}{name !== 'optionName' && ' *'}<input required={name !== 'optionName'} maxLength={name === 'productCode' ? 100 : 500} name={name} className="block h-9 w-full rounded border bg-background px-2 text-sm" /></label>)}</div>
      <p className="text-xs text-muted-foreground">필요한 몰의 판매가와 등록번호를 입력하세요. 직접 등록한 상품은 원본 파일을 다시 업로드해도 유지됩니다.</p>
      <div className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{getPriceTableDisplayColumns(sheetName).map(column => <fieldset key={column.id} className="rounded border p-2"><legend className="px-1 text-xs font-medium">{column.label}</legend><div className="flex gap-2"><label className="min-w-0 flex-1 text-xs text-muted-foreground">판매가<input aria-label={`${column.label} 판매가`} name={`price:${column.id}`} type="number" min="0" step="any" className="mt-1 h-8 w-full rounded border bg-background px-2 text-sm" /></label><label className="min-w-0 flex-1 text-xs text-muted-foreground">등록번호<input aria-label={`${column.label} 등록번호`} name={`identifier:${column.id}`} maxLength={200} className="mt-1 h-8 w-full rounded border bg-background px-2 text-sm" /></label></div></fieldset>)}</div>
      <button disabled={pending} type="submit" className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{pending ? '저장 중…' : '상품 추가'}</button>
    </form>}
  </section>
}
