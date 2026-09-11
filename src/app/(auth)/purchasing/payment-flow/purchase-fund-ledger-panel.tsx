'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { ArrowDownRight, ArrowUpRight, Loader2, Plus, Trash2, WalletCards } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  PurchaseFundLedgerData,
  PurchaseFundManualEntryType,
} from '@/lib/purchasing/purchase-fund-ledger'

export function PurchaseFundLedgerPanel({ data }: { data: PurchaseFundLedgerData }) {
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
    const parsedKrw = parseFormattedNumber(amountKrw)
    const parsedCny = amountCny.trim() ? parseFormattedNumber(amountCny) : null
    if (!Number.isFinite(parsedKrw) || parsedKrw <= 0) {
      setError('입금액(원화)을 입력해주세요.')
      return
    }
    if (parsedCny !== null && (!Number.isFinite(parsedCny) || parsedCny <= 0)) {
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
    <section className="space-y-3 rounded-lg border bg-background p-4" aria-label="발주 입금 및 잔액 장부">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <WalletCards className="size-4" />
            입금·발주 잔액
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            입금은 직접 추가하고, 주문서번호가 생성된 발주는 자동으로 차감됩니다.
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
                    <Label htmlFor="purchase-fund-krw">입금액 (원화) *</Label>
                    <div className="relative">
                      <Input
                        id="purchase-fund-krw"
                        inputMode="numeric"
                        value={amountKrw}
                        onChange={(event) => setAmountKrw(formatIntegerInput(event.target.value))}
                        className="pr-8 text-right tabular-nums"
                        placeholder="0"
                        required
                        disabled={isPending}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">원</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="purchase-fund-cny">입금액 (위안화, 선택)</Label>
                    <div className="relative">
                      <Input
                        id="purchase-fund-cny"
                        inputMode="decimal"
                        value={amountCny}
                        onChange={(event) => setAmountCny(formatDecimalInput(event.target.value))}
                        className="pr-8 text-right tabular-nums"
                        placeholder="0"
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

      <div className="grid gap-3 md:grid-cols-3">
        <FundSummaryCard
          label="누적 입금"
          amountKrw={summary.totalDepositedKrw}
          amountCny={summary.totalDepositedCny}
          tone="credit"
        />
        <FundSummaryCard
          label="발주 차감"
          amountKrw={summary.totalDebitedKrw}
          amountCny={summary.totalDebitedCny}
          tone="debit"
        />
        <FundSummaryCard
          label="현재 잔액"
          amountKrw={summary.balanceKrw}
          amountCny={summary.balanceCny}
          tone={summary.balanceKrw < 0 ? 'debit' : 'balance'}
        />
      </div>

      {summary.totalDepositedKrw === 0 && summary.totalDebitedKrw > 0 ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          기존 발주 차감만 먼저 불러왔습니다. 지금 실제 잔액부터 관리하려면 `입금내역 추가`에서 `기초잔액`을 한 번 등록해주세요.
        </div>
      ) : null}

      {summary.missingCnyDepositCount > 0 || summary.missingCostOrderCount > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {summary.missingCnyDepositCount > 0
            ? `위안화 금액을 입력하지 않은 입금 ${summary.missingCnyDepositCount.toLocaleString('ko-KR')}건이 있어 위안화 잔액은 표시하지 않습니다. `
            : null}
          {summary.missingCostOrderCount > 0
            ? `원가 미확정 발주 ${summary.missingCostOrderCount.toLocaleString('ko-KR')}건은 확인된 금액만 차감되어 있습니다.`
            : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">날짜</th>
              <th className="px-3 py-2 text-left font-medium">구분</th>
              <th className="px-3 py-2 text-left font-medium">내역</th>
              <th className="px-3 py-2 text-right font-medium">입금</th>
              <th className="px-3 py-2 text-right font-medium">발주 차감</th>
              <th className="px-3 py-2 text-right font-medium">잔액</th>
              <th className="w-12 px-2 py-2"><span className="sr-only">관리</span></th>
            </tr>
          </thead>
          <tbody>
            {data.entries.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">입금 또는 발주 차감 내역이 없습니다.</td></tr>
            ) : data.entries.map((entry) => (
              <tr key={entry.id} className="border-t align-top">
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{entry.occurredOn}</td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="inline-flex items-center gap-1">
                    {entry.entryType === 'purchase_debit'
                      ? <ArrowDownRight className="size-3.5 text-red-600" />
                      : <ArrowUpRight className="size-3.5 text-emerald-600" />}
                    {entryTypeLabel(entry.entryType)}
                  </span>
                </td>
                <td className="max-w-[360px] px-3 py-2.5 text-muted-foreground">{entry.detail}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-emerald-700">
                  {entry.isManualCredit ? formatKrw(entry.amountKrw) : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-red-700">
                  {entry.entryType === 'purchase_debit' ? formatKrw(entry.amountKrw) : '-'}
                </td>
                <td className={`whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums ${entry.balanceKrw < 0 ? 'text-red-700' : ''}`}>
                  {formatKrw(entry.balanceKrw)}
                </td>
                <td className="px-2 py-2 text-right">
                  {entry.isManualCredit ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => voidEntry(entry.id)}
                      disabled={isPending}
                      aria-label="입금 내역 취소"
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        주문서번호가 없는 대량결제대기 상품은 아직 차감하지 않습니다. 자동 차감 내역은 원본 발주가 2개월 후 정리되어도 장부에 계속 남으며, 기초잔액은 해당 날짜부터 잔액 계산을 다시 시작합니다.
      </p>
    </section>
  )
}

function FundSummaryCard({
  label,
  amountKrw,
  amountCny,
  tone,
}: {
  label: string
  amountKrw: number
  amountCny: number | null
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
      <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{formatKrw(amountKrw)}</p>
      <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
        {amountCny === null ? '위안화 금액 확인 필요' : `${formatCny(amountCny)} 元`}
      </p>
    </div>
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

function todayKst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
