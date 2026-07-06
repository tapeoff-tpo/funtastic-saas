'use client'

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Save, Sparkles, Trash2, WalletCards } from 'lucide-react'
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

export function PurchaseRecommendationGenerator() {
  const router = useRouter()
  const [targetStockMonths, setTargetStockMonths] = useState('1.2')
  const [budgetKrw, setBudgetKrw] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function generate() {
    const months = Number(targetStockMonths)
    if (!Number.isFinite(months) || months < 0.1 || months > 12) {
      setError('목표 보유개월수는 0.1~12 사이로 입력해주세요.')
      return
    }
    const budget = budgetKrw.trim() === '' ? null : Number(budgetKrw)
    if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 10_000_000_000)) {
      setError('구매예산은 1원~100억원 사이로 입력해주세요.')
      return
    }

    setMessage(null)
    setError(null)
    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStockMonths: months, budgetKrw: budget }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error ?? '자동 발주 추천 생성에 실패했습니다.')
        return
      }

      setMessage(
        `재고 ${body.evaluated.toLocaleString('ko-KR')}개 검수 · ` +
        `발주추천 ${body.created.toLocaleString('ko-KR')}건 생성 · ` +
        `기존 자동추천 ${(body.replaced ?? 0).toLocaleString('ko-KR')}건 교체 · ` +
        `급증 ${(body.salesAnomalyCount ?? 0).toLocaleString('ko-KR')}건 보정` +
        (budget !== null
          ? ` · 예산 ${(body.spentBudgetKrw ?? 0).toLocaleString('ko-KR')}원 사용 · ` +
            `원가누락 ${(body.missingCostExcluded ?? 0).toLocaleString('ko-KR')}건 제외 · ` +
            `예산조정 ${(body.budgetLimitedCount ?? 0).toLocaleString('ko-KR')}건`
          : ''),
      )
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-background p-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">자동 발주 추천</p>
        <p className="text-xs text-muted-foreground">
          판매 급증을 보정하고 재고 소진 위험이 높은 품목부터 예산 안에서 발주수량을 배분합니다.
        </p>
        {message && <p className="mt-1 text-xs text-emerald-700">{message}</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <label className="text-xs text-muted-foreground" htmlFor="target-stock-months">
          목표 보유개월
        </label>
        <Input
          id="target-stock-months"
          type="number"
          min="0.1"
          max="12"
          step="0.1"
          value={targetStockMonths}
          onChange={(event) => setTargetStockMonths(event.target.value)}
          className="h-9 w-24"
        />
        <label className="text-xs text-muted-foreground" htmlFor="purchase-budget-krw">
          구매예산
        </label>
        <div className="relative">
          <WalletCards className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="purchase-budget-krw"
            type="number"
            min="1"
            max="10000000000"
            step="10000"
            placeholder="원화 예산"
            value={budgetKrw}
            onChange={(event) => setBudgetKrw(event.target.value)}
            className="h-9 w-36 pl-8"
          />
        </div>
        <Button type="button" onClick={generate} disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          추천 계산
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
