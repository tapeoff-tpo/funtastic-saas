'use client'

import {
  createContext,
  useContext,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Save, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  PURCHASE_REQUEST_STATUS_LABELS,
  type PurchaseRequestStatus,
} from '@/lib/purchasing/purchase-request-status'

type BulkSelectionContextValue = {
  ids: string[]
  selectedIds: Set<string>
  nextStatus: PurchaseRequestStatus | null
  toggle: (id: string) => void
  toggleAll: () => void
  clear: () => void
}

const BulkSelectionContext = createContext<BulkSelectionContextValue | null>(null)

export function PurchaseBulkSelectionProvider({
  ids,
  nextStatus,
  children,
}: {
  ids: string[]
  nextStatus: PurchaseRequestStatus | null
  children: ReactNode
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds((current) => (
      ids.length > 0 && ids.every((id) => current.has(id))
        ? new Set()
        : new Set(ids)
    ))
  }

  function clear() {
    setSelectedIds(new Set())
  }

  return (
    <BulkSelectionContext.Provider value={{ ids, selectedIds, nextStatus, toggle, toggleAll, clear }}>
      {children}
    </BulkSelectionContext.Provider>
  )
}

export function PurchaseSelectAllCheckbox() {
  const context = useBulkSelection()
  const checked = context.ids.length > 0 && context.ids.every((id) => context.selectedIds.has(id))
  const indeterminate = context.selectedIds.size > 0 && !checked

  return (
    <input
      type="checkbox"
      aria-label="현재 목록 전체 선택"
      checked={checked}
      ref={(node) => {
        if (node) node.indeterminate = indeterminate
      }}
      onChange={context.toggleAll}
      className="h-4 w-4"
    />
  )
}

export function PurchaseRowCheckbox({ id }: { id: string }) {
  const context = useBulkSelection()

  return (
    <input
      type="checkbox"
      aria-label="발주 항목 선택"
      checked={context.selectedIds.has(id)}
      onChange={() => context.toggle(id)}
      className="h-4 w-4"
    />
  )
}

export function PurchaseBulkStatusButton() {
  const router = useRouter()
  const context = useBulkSelection()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedCount = context.selectedIds.size

  if (!context.nextStatus) return null

  function moveSelected() {
    const ids = Array.from(context.selectedIds)
    if (ids.length === 0) return
    setMessage(null)

    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status: context.nextStatus }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || (Array.isArray(body.failed) && body.failed.length > 0)) {
        setMessage(body.error ?? '선택 항목 이동에 실패했습니다.')
        router.refresh()
        return
      }

      context.clear()
      setMessage(`${body.updatedCount.toLocaleString('ko-KR')}건 이동 완료`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={moveSelected}
        disabled={isPending || selectedCount === 0}
      >
        {isPending ? <Loader2 className="animate-spin" /> : <Check />}
        선택 {selectedCount.toLocaleString('ko-KR')}건 {PURCHASE_REQUEST_STATUS_LABELS[context.nextStatus]}로 이동
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  )
}

function useBulkSelection() {
  const context = useContext(BulkSelectionContext)
  if (!context) throw new Error('Purchase bulk selection context is missing.')
  return context
}

export function PurchaseRequestUpload() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('업로드할 엑셀 파일을 선택해 주세요.')
      return
    }

    setError(null)
    setMessage(null)
    const form = new FormData()
    form.append('file', file)

    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests/import', {
        method: 'POST',
        body: form,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error ?? '업로드에 실패했습니다.')
        return
      }

      setMessage(`총 ${body.total.toLocaleString('ko-KR')}건 중 ${body.imported.toLocaleString('ko-KR')}건을 가져왔습니다.`)
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-background p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">이카운트 발주 엑셀 가져오기</p>
        <p className="text-xs text-muted-foreground">
          발주등록 시트의 품목코드, 구매수량, 도착요청일, 담당자 정보를 발주요청으로 저장합니다.
        </p>
        {message && <p className="mt-1 text-xs text-emerald-700">{message}</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input ref={fileRef} type="file" accept=".xlsx,.xls" className="w-64" />
        <Button type="button" onClick={upload} disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" /> : <Upload />}
          업로드
        </Button>
      </div>
    </div>
  )
}

export function PurchaseStatusButton({
  id,
  nextStatus,
}: {
  id: string
  nextStatus: PurchaseRequestStatus | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (!nextStatus) return null

  function moveStatus() {
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (response.ok) {
        router.refresh()
        return
      }
      const body = await response.json().catch(() => ({}))
      window.alert(body.error ?? '진행상태 변경에 실패했습니다.')
    })
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={moveStatus} disabled={isPending}>
      {isPending ? <Loader2 className="animate-spin" /> : <Check />}
      {PURCHASE_REQUEST_STATUS_LABELS[nextStatus]}로 이동
    </Button>
  )
}

export function PurchaseDeleteButton({
  id,
  productName,
}: {
  id: string
  productName: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function remove() {
    if (!window.confirm(`${productName} 발주 항목을 삭제할까요?`)) return
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'DELETE',
      })
      if (response.ok) router.refresh()
      else {
        const body = await response.json().catch(() => ({}))
        window.alert(body.error ?? '삭제에 실패했습니다.')
      }
    })
  }

  return (
    <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={isPending}>
      {isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      삭제
    </Button>
  )
}

export function PurchasePlanFields({
  id,
  supplierOrderNumber,
  outboundExpectedDate,
  purchaseMethod,
  purchaseConfirmed,
}: {
  id: string
  supplierOrderNumber: string | null
  outboundExpectedDate: string | Date | null
  purchaseMethod: string | null
  purchaseConfirmed: boolean
}) {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierOrderNumber: String(formData.get('supplierOrderNumber') ?? ''),
          outboundExpectedDate: String(formData.get('outboundExpectedDate') ?? '') || null,
          purchaseMethod: String(formData.get('purchaseMethod') ?? ''),
          purchaseConfirmed: formData.get('purchaseConfirmed') === 'on',
        }),
      })
      setMessage(response.ok ? '저장됨' : '저장 실패')
      if (response.ok) router.refresh()
    })
  }

  return (
    <form onSubmit={save} className="grid min-w-[520px] grid-cols-[1fr_120px_120px_72px_82px] items-center gap-1">
      <Input
        name="supplierOrderNumber"
        defaultValue={supplierOrderNumber ?? ''}
        placeholder="주문서번호"
        className="h-7 text-xs"
      />
      <Input
        name="outboundExpectedDate"
        type="date"
        defaultValue={formatDateInput(outboundExpectedDate)}
        className="h-7 text-xs"
      />
      <Input
        name="purchaseMethod"
        defaultValue={purchaseMethod ?? ''}
        placeholder="구매방식"
        className="h-7 text-xs"
      />
      <label className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <input
          name="purchaseConfirmed"
          type="checkbox"
          defaultChecked={purchaseConfirmed}
          className="h-3.5 w-3.5"
        />
        구매
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" /> : <Save />}
        {message ?? '저장'}
      </Button>
    </form>
  )
}

function formatDateInput(value: string | Date | null) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value.slice(0, 10)
}
