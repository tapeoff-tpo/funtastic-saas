'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { saveMallPrice } from './price-registration-actions'

export function MallPriceCell({ rowId, mallId, mallName, productName, price, override, canEdit, children }: {
  rowId: string
  mallId: string
  mallName: string
  productName: string
  price: number | null
  override: number | null
  canEdit: boolean
  children: ReactNode
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, startTransition] = useTransition()
  function save(value: string) {
    startTransition(async () => {
      try {
        const result = await saveMallPrice({ rowId, mallId, price: value, previousPrice: override })
        if (result.error) {
          toast.error(result.error)
          return
        }
        setEditing(false)
        toast.success('판매가를 저장했습니다.')
        router.refresh()
      } catch {
        toast.error('판매가를 저장하지 못했습니다. 다시 시도해주세요.')
      }
    })
  }
  const amount = price === null ? '가격 미입력' : `${price.toLocaleString('ko-KR')}원`
  return <div className="relative">
    {canEdit ? <button type="button" className="block w-full text-right hover:underline"
      aria-label={`${mallName} ${productName} 판매가 수정`}
      onClick={() => { setDraft(price === null ? '' : String(price)); setEditing(true) }}>
      {children}
      <span className={`mt-0.5 block text-[10px] ${override !== null ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
        title={override !== null ? '직접 수정한 판매가' : '기본 판매가'}>{amount}{override !== null && ' · 수정'}</span>
    </button> : <>{children}<span className={`mt-0.5 block text-[10px] ${override !== null ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{amount}{override !== null && ' · 수정'}</span></>}
    {editing && <div role="dialog" aria-label={`${mallName} 판매가 수정`}
      className="relative z-30 mt-2 w-full space-y-2 rounded-md border bg-popover p-3 text-left text-popover-foreground shadow-lg">
      <p className="text-sm font-medium">{mallName} 판매가</p>
      <p className="truncate text-xs text-muted-foreground" title={productName}>{productName}</p>
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); save(draft) }}>
        <label className="grid gap-1 text-xs">판매가격 (원)
          <input autoFocus type="number" min="0" max="9999999999.99" step="0.01" required value={draft}
            onChange={(event) => setDraft(event.target.value)} disabled={pending}
            className="w-full rounded border bg-background px-2 py-1.5 text-sm" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button disabled={pending} className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground">저장</button>
          <button type="button" disabled={pending} onClick={() => setEditing(false)} className="rounded border px-3 py-1.5 text-xs">취소</button>
          {override !== null && <button type="button" disabled={pending} onClick={() => save('')} className="text-xs text-muted-foreground underline">기본가로 복원</button>}
        </div>
      </form>
    </div>}
  </div>
}
