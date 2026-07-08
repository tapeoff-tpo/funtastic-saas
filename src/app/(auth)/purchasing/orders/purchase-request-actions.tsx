'use client'

import {
  createContext,
  useContext,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
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

const PURCHASE_BUYERS = [
  { code: '1', name: '한상철' },
  { code: '2', name: '김기환' },
  { code: '3', name: '최종석' },
  { code: '4', name: '오지은' },
  { code: '5', name: '김소희' },
]

export function PurchaseBulkBuyerApply() {
  const router = useRouter()
  const context = useBulkSelection()
  const [buyerCode, setBuyerCode] = useState('4')
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedCount = context.selectedIds.size
  const targetCount = selectedCount || context.ids.length

  function apply() {
    const ids = selectedCount ? Array.from(context.selectedIds) : context.ids
    if (ids.length === 0) return
    setMessage(null)
    startTransition(async () => {
      const response = await fetch('/api/purchasing/purchase-requests/bulk-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, buyerCode }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage(body.error ?? '담당자 적용 실패')
        return
      }
      setMessage(`${body.updatedCount.toLocaleString('ko-KR')}건 적용`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={buyerCode}
        onChange={(event) => setBuyerCode(event.target.value)}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
      >
        {PURCHASE_BUYERS.map((buyer) => (
          <option key={buyer.code} value={buyer.code}>{buyer.name}</option>
        ))}
      </select>
      <Button type="button" size="sm" variant="outline" onClick={apply} disabled={isPending || targetCount === 0}>
        {isPending ? <Loader2 className="animate-spin" /> : <Check />}
        담당자 전체적용
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  )
}


export function PurchaseBulkDeleteButton() {
  const router = useRouter()
  const context = useBulkSelection()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedCount = context.selectedIds.size

  function removeSelected() {
    const ids = Array.from(context.selectedIds)
    if (ids.length === 0) return
    if (!window.confirm(`선택한 ${ids.length.toLocaleString('ko-KR')}건을 삭제할까요?`)) return
    setMessage(null)
    startTransition(async () => {
      let deletedCount = 0
      for (const id of ids) {
        const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
          method: 'DELETE',
        })
        if (response.ok) deletedCount += 1
      }
      context.clear()
      setMessage(`${deletedCount.toLocaleString('ko-KR')}건 삭제`)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="destructive" onClick={removeSelected} disabled={isPending || selectedCount === 0}>
        {isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        선택 삭제 {selectedCount.toLocaleString('ko-KR')}
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
      setError('목표 보유개월은 0.1~12 사이로 입력해주세요.')
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
        `재고 ${body.evaluated.toLocaleString('ko-KR')}개 검색 · ` +
        `발주추천 ${body.created.toLocaleString('ko-KR')}건 생성 · ` +
        `기존 자동추천 ${(body.replaced ?? 0).toLocaleString('ko-KR')}건 교체 · ` +
        `급증 ${(body.salesAnomalyCount ?? 0).toLocaleString('ko-KR')}건 보정` +
        (budget !== null
          ? ` · 예산 ${(body.spentBudgetKrw ?? 0).toLocaleString('ko-KR')}원 사용 · ` +
            `원가 누락 ${(body.missingCostExcluded ?? 0).toLocaleString('ko-KR')}건 제외 · ` +
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

export function PurchaseQuantityField({
  id,
  field,
  quantity,
  stockLimit,
  costSummary,
}: {
  id: string
  field: 'requestedQuantity' | 'actualPurchaseQuantity' | 'chinaReceivedQuantity' | 'outboundRequestedQuantity'
  quantity: number
  stockLimit?: number | null
  costSummary?: {
    unitCostYuan: number | null
    unitCostKrw: number | null
  }
}) {
  const [value, setValue] = useState(String(quantity))
  const [savedValue, setSavedValue] = useState(String(quantity))
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const previewQuantity = parseQuantityPreview(value, quantity)
  const totalCostYuan = costSummary?.unitCostYuan === null || costSummary?.unitCostYuan === undefined
    ? null
    : costSummary.unitCostYuan * previewQuantity
  const totalCostKrw = costSummary?.unitCostKrw === null || costSummary?.unitCostKrw === undefined
    ? null
    : costSummary.unitCostKrw * previewQuantity

  function save() {
    const nextQuantity = Number(value)
    const minimum = field === 'requestedQuantity' ? 1 : 0
    if (!Number.isInteger(nextQuantity) || nextQuantity < minimum) {
      setMessage(field === 'requestedQuantity' ? '1 이상 정수' : '0 이상 정수')
      return
    }
    if (String(nextQuantity) === savedValue) {
      setMessage(null)
      return
    }

    setMessage('저장 중')
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: nextQuantity }),
      })
      if (response.ok) {
        const nextValue = String(nextQuantity)
        setSavedValue(nextValue)
        setValue(nextValue)
        setMessage(null)
        return
      }
      setMessage('저장 실패')
    })
  }

  function saveOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.currentTarget.blur()
  }

  return (
    <div className="mx-auto w-[128px]">
      <div className="flex items-center justify-center gap-1">
        <Input
          type="number"
          min={field === 'requestedQuantity' ? 1 : 0}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={saveOnEnter}
          disabled={isPending}
          aria-label="수량"
          className="h-7 w-16 px-2 text-center text-xs tabular-nums"
        />
        {stockLimit !== undefined && stockLimit !== null ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            /{stockLimit.toLocaleString('ko-KR')}
          </span>
        ) : null}
      </div>
      {costSummary ? (
        <div className="mt-1 space-y-0.5 text-center text-[11px] leading-tight tabular-nums">
          <div className="whitespace-nowrap font-semibold text-foreground">
            총 元 {formatCostValue(totalCostYuan, 2)} / ₩ {formatCostValue(totalCostKrw, 0)}
          </div>
          <div className="whitespace-nowrap text-muted-foreground">
            개당 元 {formatCostValue(costSummary.unitCostYuan, 2)} / ₩ {formatCostValue(costSummary.unitCostKrw, 0)}
          </div>
        </div>
      ) : null}
      {message ? (
        <div className={message === '저장 중' ? 'sr-only' : 'mt-1 text-center text-[11px] text-destructive'}>
          {message}
        </div>
      ) : null}
    </div>
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

export function PurchasePlanFieldsV2({
  id,
  supplierOrderNumber,
  outboundExpectedDate,
  purchaseMethod,
}: {
  id: string
  supplierOrderNumber: string | null
  outboundExpectedDate: string | Date | null
  purchaseMethod: string | null
}) {
  const router = useRouter()
  const initialMethod = purchaseMethod === '개인' || purchaseMethod === '법인' ? purchaseMethod : purchaseMethod ? '직접입력' : '개인'
  const [methodMode, setMethodMode] = useState(initialMethod)
  const [customMethod, setCustomMethod] = useState(initialMethod === '직접입력' ? purchaseMethod ?? '' : '')
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
          purchaseMethod: methodMode === '직접입력' ? customMethod : methodMode,
        }),
      })
      setMessage(response.ok ? '저장됨' : '저장 실패')
      if (response.ok) router.refresh()
    })
  }

  return (
    <form onSubmit={save} className="grid min-w-[590px] grid-cols-[1fr_130px_190px_82px] items-end gap-1.5">
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-muted-foreground">주문서번호</span>
        <Input
          name="supplierOrderNumber"
          defaultValue={supplierOrderNumber ?? ''}
          placeholder="주문서번호"
          className="h-7 text-xs"
        />
      </label>
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-muted-foreground">구매날짜</span>
        <Input
          name="outboundExpectedDate"
          type="date"
          defaultValue={formatDateInput(outboundExpectedDate) || todayDateInput()}
          className="h-7 text-xs"
        />
      </label>
      <label className="space-y-1">
        <span className="block text-[11px] font-medium text-muted-foreground">구매방법</span>
        <div className="flex items-center gap-1">
          <select
            value={methodMode}
            onChange={(event) => setMethodMode(event.target.value)}
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="개인">개인</option>
            <option value="법인">법인</option>
            <option value="직접입력">직접입력</option>
          </select>
          {methodMode === '직접입력' ? (
            <Input
              value={customMethod}
              onChange={(event) => setCustomMethod(event.target.value)}
              placeholder="직접입력"
              className="h-7 w-24 text-xs"
            />
          ) : null}
        </div>
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? <Loader2 className="animate-spin" /> : <Save />}
        {message ?? '저장'}
      </Button>
    </form>
  )
}

export function PurchaseBuyerField({
  id,
  buyerCode,
}: {
  id: string
  buyerCode: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(
    buyerCode && PURCHASE_BUYERS.some((buyer) => buyer.code === buyerCode) ? buyerCode : '4',
  )
  const [isPending, startTransition] = useTransition()

  function save(nextValue: string) {
    setValue(nextValue)
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyerCode: nextValue }),
      })
      if (response.ok) router.refresh()
    })
  }

  return (
    <select
      value={value}
      onChange={(event) => save(event.target.value)}
      disabled={isPending}
      className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
    >
      {PURCHASE_BUYERS.map((buyer) => (
        <option key={buyer.code} value={buyer.code}>{buyer.name}</option>
      ))}
    </select>
  )
}

function parseQuantityPreview(value: string, fallback: number) {
  const next = Number(value)
  if (!Number.isFinite(next) || next < 0) return fallback
  return next
}

function formatCostValue(value: number | null, maximumFractionDigits: number) {
  if (value === null) return '-'
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })
}

function formatDateInput(value: string | Date | null) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value.slice(0, 10)
}

function todayDateInput() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '00'
  const day = parts.find((part) => part.type === 'day')?.value ?? '00'
  return `${year}-${month}-${day}`
}
