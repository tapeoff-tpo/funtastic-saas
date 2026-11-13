'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Loader2, Plus, Trash2, WalletCards } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import { calculateAppliedPurchaseExchangeRateKrw } from '@/lib/purchasing/purchase-costs'
import type {
  PurchaseFundLedgerData,
  PurchaseFundManualEntryType,
} from '@/lib/purchasing/purchase-fund-ledger'
import { MonthlyFundDashboard } from './monthly-fund-dashboard'
import { ChinaFundStatementPanel } from './china-fund-statement-panel'

export function PurchaseFundLedgerPanel({
  data,
  exchangeRateReference,
}: {
  data: PurchaseFundLedgerData
  exchangeRateReference: CnyKrwReferenceRate
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [entryType, setEntryType] = useState<PurchaseFundManualEntryType>('deposit')
  const [occurredOn, setOccurredOn] = useState(todayKst())
  const [amountKrw, setAmountKrw] = useState('')
  const [amountCny, setAmountCny] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const summary = data.summary
  const appliedExchangeRate = calculateAppliedPurchaseExchangeRateKrw(exchangeRateReference.rate)

  function resetForm() {
    setEntryType('deposit')
    setOccurredOn(todayKst())
    setAmountKrw('')
    setAmountCny('')
    setMemo('')
    setError(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedKrw = amountKrw.trim() ? parseFormattedNumber(amountKrw) : 0
    const parsedCny = parseFormattedNumber(amountCny)
    if (!Number.isFinite(parsedKrw) || parsedKrw < 0) {
      setError('입금액(원화)을 올바르게 입력해주세요.')
      return
    }
    if (!Number.isFinite(parsedCny) || parsedCny <= 0) {
      setError('입금액(위안화)을 올바르게 입력해주세요.')
      return
    }

    setError(null)
    startTransition(async () => {
      const response = await fetch('/api/purchasing/payment-flow/fund-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryType,
          occurredOn,
          amountKrw: parsedKrw,
          amountCny: parsedCny,
          memo: memo.trim() || null,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error ?? '입금 내역을 저장하지 못했습니다.')
        return
      }

      setOpen(false)
      resetForm()
      toast.success(entryType === 'opening_balance' ? '기초잔액을 저장했습니다.' : '입금 내역을 저장했습니다.')
      router.refresh()
    })
  }

  function voidEntry(id: string) {
    if (!window.confirm('이 입금 내역을 취소할까요? 잔액에서도 제외됩니다.')) return
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/payment-flow/fund-entries/${id}`, {
        method: 'DELETE',
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? '입금 내역을 취소하지 못했습니다.')
        return
      }
      toast.success('입금 내역을 취소했습니다.')
      router.refresh()
    })
  }

  return (
    <section className="space-y-4 rounded-lg border bg-background p-4" aria-label="발주금액 및 입금 잔액 현황">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <WalletCards className="size-4" />
            발주금액 · 입금/잔액 현황
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            입금은 직접 기록하며, 2026년 11월 1일 이후 발주요청 단계에 등록된 발주부터 자동 차감됩니다.
          </p>
        </div>
        <Dialog.Root
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen)
            if (nextOpen) resetForm()
          }}
        >
          <Dialog.Trigger
            render={(props) => (
              <Button {...props} type="button" size="sm">
                <Plus />
                입금내역 추가
              </Button>
            )}
          />
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
            <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-5 shadow-xl">
              <Dialog.Title className="text-base font-semibold">입금내역 추가</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                실제 입금액을 기록합니다. 기초잔액은 선택한 날짜 이전 내역을 계산에서 제외하고 그날 잔액부터 새로 시작합니다.
              </Dialog.Description>
              <form onSubmit={submit} className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="purchase-fund-entry-type">구분</Label>
                    <select
                      id="purchase-fund-entry-type"
                      value={entryType}
                      onChange={(event) => setEntryType(event.target.value as PurchaseFundManualEntryType)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={isPending}
                    >
                      <option value="deposit">입금</option>
                      <option value="opening_balance">기초잔액</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="purchase-fund-date">입금일</Label>
                    <Input
                      id="purchase-fund-date"
                      type="date"
                      value={occurredOn}
                      onChange={(event) => setOccurredOn(event.target.value)}
                      required
                      disabled={isPending}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="purchase-fund-krw">입금액 (원화, 선택)</Label>
                    <div className="relative">
                      <Input
                        id="purchase-fund-krw"
                        inputMode="numeric"
                        value={amountKrw}
                        onChange={(event) => setAmountKrw(formatIntegerInput(event.target.value))}
                        className="pr-8 text-right tabular-nums"
                        placeholder="0"
                        disabled={isPending}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="purchase-fund-cny">입금액 (위안화) *</Label>
                    <div className="relative">
                      <Input
                        id="purchase-fund-cny"
                        inputMode="decimal"
                        value={amountCny}
                        onChange={(event) => setAmountCny(formatDecimalInput(event.target.value))}
                        className="pr-8 text-right tabular-nums"
                        placeholder="0"
                        required
                        disabled={isPending}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">元</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="purchase-fund-memo">메모</Label>
                  <Input
                    id="purchase-fund-memo"
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                    maxLength={500}
                    placeholder="예: 9월 1차 구매대금 입금"
                    disabled={isPending}
                  />
                </div>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <div className="flex justify-end gap-2">
                  <Dialog.Close
                    render={(props) => (
                      <Button {...props} type="button" variant="outline" disabled={isPending}>취소</Button>
                    )}
                  />
                  <Button type="submit" disabled={isPending}>
                    {isPending ? <Loader2 className="animate-spin" /> : null}
                    저장
                  </Button>
                </div>
              </form>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2.5 text-xs" aria-label="발주금액 계산 환율">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <p>
            <span className="text-muted-foreground">현재 조회 기준환율 </span>
            <span className="font-semibold tabular-nums">{formatRate(exchangeRateReference.rate)}원/元</span>
            <span className="ml-1 text-muted-foreground">
              {exchangeRateReference.source === 'fallback'
                ? '(환율 조회 실패 · 임시값)'
                : exchangeRateReference.date ? `(고시일 ${exchangeRateReference.date})` : ''}
            </span>
          </p>
          <p>
            <span className="text-muted-foreground">원화 계산 적용환율 </span>
            <span className="font-semibold tabular-nums">{appliedExchangeRate === null ? '-' : formatRate(appliedExchangeRate)}원/元</span>
            <span className="ml-1 text-muted-foreground">(기준환율 × 1.05)</span>
          </p>
        </div>
        <p className="mt-1 text-muted-foreground">기존 발주에 저장된 환율이 있으면 해당 환율을 우선 적용합니다.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <FundSummaryCard
          label="누적 입금 (위안화 기준)"
          amountKrw={summary.totalDepositedKrw}
          amountCny={summary.totalDepositedCny}
          unknownReason={summary.missingCnyDepositCount > 0
            ? `위안화 금액 누락 입금 ${summary.missingCnyDepositCount.toLocaleString('ko-KR')}건`
            : null}
          tone="credit"
        />
        <FundSummaryCard
          label="발주 차감 (위안화 기준)"
          amountKrw={summary.totalDebitedKrw}
          amountCny={summary.totalDebitedCny}
          unknownReason={summary.missingCostOrderCount > 0
            ? `원가 또는 중복·기초잔액 확인 필요 ${summary.missingCostOrderCount.toLocaleString('ko-KR')}건`
            : null}
          tone="debit"
        />
        <FundSummaryCard
          label="현재 잔액 (위안화 기준)"
          amountKrw={summary.balanceKrw}
          amountCny={summary.balanceCny}
          unknownReason={[
            summary.missingCnyDepositCount > 0
              ? `위안화 누락 입금 ${summary.missingCnyDepositCount.toLocaleString('ko-KR')}건`
              : null,
            summary.missingCostOrderCount > 0
              ? `원가 또는 중복·기초잔액 확인 필요 ${summary.missingCostOrderCount.toLocaleString('ko-KR')}건`
              : null,
          ].filter(Boolean).join(' · ') || null}
          tone={summary.balanceCny !== null && summary.balanceCny < 0 ? 'debit' : 'balance'}
        />
      </div>

      <MonthlyFundDashboard monthly={data.monthly} />

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-semibold">입금 기록 · 중국 입금표</summary>
        <div className="mt-4 space-y-4">
          <details>
            <summary className="cursor-pointer text-sm font-semibold">입금 기록 관리</summary>
            <div className="mt-2 divide-y rounded-md border">
              {data.entries.filter((entry) => entry.isManualCredit).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div><span>{entry.occurredOn} · {entryTypeLabel(entry.entryType)}</span>{entry.memo ? <span className="ml-2 text-muted-foreground">{entry.memo}</span> : null}</div>
                  <div className="flex items-center gap-2"><LedgerAmount amountCny={entry.amountCny} amountKrw={entry.amountKrw} /><Button type="button" size="icon-sm" variant="ghost" onClick={() => voidEntry(entry.id)} disabled={isPending} aria-label="입금 내역 취소"><Trash2 /></Button></div>
                </div>
              ))}
            </div>
          </details>
          <ChinaFundStatementPanel purchaseDeductionCny={summary.totalDebitedCny} />
        </div>
      </details>

      {(
        (summary.totalDepositedCny === 0 && summary.totalDebitedCny !== null && summary.totalDebitedCny > 0)
        || summary.missingCnyDepositCount > 0
        || summary.missingCostOrderCount > 0
      ) ? (
        <aside aria-label="정산 참고" className="border-t pt-3">
          <div className="space-y-1.5 text-[11px] leading-4">
            {summary.totalDepositedCny === 0 && summary.totalDebitedCny !== null && summary.totalDebitedCny > 0 ? (
              <p className="rounded-sm border border-blue-100 bg-blue-50/50 px-2 py-1.5 text-blue-800">
                기존 발주 차감만 먼저 불러왔습니다. 실제 잔액부터 관리하려면 `입금내역 추가`에서 `기초잔액`을 한 번 등록해주세요.
              </p>
            ) : null}
            {summary.missingCnyDepositCount > 0 || summary.missingCostOrderCount > 0 ? (
              <p className="rounded-sm border border-amber-100 bg-amber-50/50 px-2 py-1.5 text-amber-800">
                {summary.missingCnyDepositCount > 0
                  ? `위안화 금액 누락 입금 ${summary.missingCnyDepositCount.toLocaleString('ko-KR')}건이 있어 누적 입금액과 잔액을 확정할 수 없습니다. `
                  : null}
                {summary.missingCostOrderCount > 0
                  ? `원가 또는 중복·기초잔액 확인이 필요한 발주 ${summary.missingCostOrderCount.toLocaleString('ko-KR')}건이 있어 발주 차감액과 잔액을 확정할 수 없습니다.`
                  : null}
              </p>
            ) : null}
            {data.requestReviewItems?.length ? (
              <details className="rounded-sm border px-2 py-1.5">
                <summary className="cursor-pointer font-medium">중복·기초잔액 확인이 필요한 발주 {data.requestReviewItems.length.toLocaleString('ko-KR')}건</summary>
                <ul className="mt-1 space-y-1">{data.requestReviewItems.slice(0, 10).map((item) => <li key={item.id}>{item.occurredOn} · {item.productName} ({item.sku}) · {item.reason}</li>)}</ul>
                {data.requestReviewItems.length > 10 ? <p className="mt-1">상위 10건만 표시됩니다.</p> : null}
              </details>
            ) : null}
          </div>
        </aside>
      ) : null}
    </section>
  )
}

function FundSummaryCard({
  label,
  amountKrw,
  amountCny,
  unknownReason,
  tone,
}: {
  label: string
  amountKrw: number
  amountCny: number | null
  unknownReason: string | null
  tone: 'credit' | 'debit' | 'balance'
}) {
  const color = tone === 'credit'
    ? 'text-emerald-700'
    : tone === 'debit'
      ? 'text-red-700'
      : 'text-foreground'
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>
        {amountCny === null ? '위안화 금액 확인 필요' : `${formatCny(amountCny)} 元`}
      </p>
      <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{formatKrw(amountKrw)}</p>
      {amountCny === null && unknownReason ? (
        <p className="mt-1 text-[11px] leading-4 text-amber-700">{unknownReason}</p>
      ) : null}
    </div>
  )
}

function LedgerAmount({
  amountCny,
  amountKrw,
  className = '',
}: {
  amountCny: number | null
  amountKrw: number
  className?: string
}) {
  return (
    <span className={className}>
      <span className="block font-medium">
        {amountCny === null ? '위안화 금액 확인 필요' : `${formatCny(amountCny)} 元`}
      </span>
      <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">{formatKrw(amountKrw)}</span>
    </span>
  )
}

function entryTypeLabel(value: PurchaseFundLedgerData['entries'][number]['entryType']) {
  if (value === 'deposit') return '입금'
  if (value === 'opening_balance') return '기초잔액'
  return '발주 차감'
}

function parseFormattedNumber(value: string) {
  return Number(value.replace(/,/g, '').trim())
}

function formatIntegerInput(value: string) {
  const digits = value.replace(/[^0-9]/g, '')
  return digits ? Number(digits).toLocaleString('ko-KR') : ''
}

function formatDecimalInput(value: string) {
  const normalized = value.replace(/[^0-9.]/g, '')
  const [integer = '', ...decimalParts] = normalized.split('.')
  const formattedInteger = integer ? Number(integer).toLocaleString('ko-KR') : ''
  if (decimalParts.length === 0) return formattedInteger
  return `${formattedInteger}.${decimalParts.join('').slice(0, 2)}`
}

function formatKrw(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatCny(value: number) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

function formatRate(value: number) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

function todayKst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}


