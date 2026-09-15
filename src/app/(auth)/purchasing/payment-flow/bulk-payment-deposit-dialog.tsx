'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Loader2, WalletCards } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PurchasePaymentFlowDetailItem } from '@/lib/purchasing/purchase-requests'

type BulkPaymentDepositItem = Pick<PurchasePaymentFlowDetailItem,
  | 'id'
  | 'productName'
  | 'optionName'
  | 'totalCostYuan'
  | 'totalCostKrw'
  | 'bulkPaymentDepositCny'
  | 'bulkPaymentDepositKrw'
  | 'bulkPaymentDepositPaidAt'
  | 'bulkPaymentDepositMemo'
>

export function BulkPaymentDepositDialog({ item }: { item: BulkPaymentDepositItem }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [depositCny, setDepositCny] = useState(formatDecimal(item.bulkPaymentDepositCny))
  const [paidAt, setPaidAt] = useState(item.bulkPaymentDepositPaidAt ?? todayKst())
  const [memo, setMemo] = useState(item.bulkPaymentDepositMemo ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const totalCny = item.totalCostYuan ?? 0
  const parsedDeposit = parseNumber(depositCny)
  const previewDeposit = Number.isFinite(parsedDeposit) && parsedDeposit >= 0 ? parsedDeposit : item.bulkPaymentDepositCny
  const remainingCny = Math.max(0, totalCny - previewDeposit)

  function resetForm() {
    setDepositCny(formatDecimal(item.bulkPaymentDepositCny))
    setPaidAt(item.bulkPaymentDepositPaidAt ?? todayKst())
    setMemo(item.bulkPaymentDepositMemo ?? '')
    setError(null)
  }

  function save(nextDepositCny?: number) {
    const amount = nextDepositCny ?? parseNumber(depositCny)
    if (!Number.isFinite(amount) || amount < 0) {
      setError('선금(元)을 0 이상의 숫자로 입력해주세요.')
      return
    }
    if (amount > totalCny + 0.001) {
      setError(`선금은 발주금액 ${formatCny(totalCny)}元을 넘을 수 없습니다.`)
      return
    }
    if (amount > 0 && !paidAt) {
      setError('선금 지급일을 입력해주세요.')
      return
    }

    setError(null)
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/purchase-requests/${item.id}/bulk-payment-deposit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositCny: Math.round(amount * 100) / 100,
          depositPaidAt: amount > 0 ? paidAt : null,
          depositMemo: amount > 0 ? memo.trim() || null : null,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(body.error ?? '선금 정보를 저장하지 못했습니다.')
        return
      }

      setOpen(false)
      toast.success(amount > 0 ? '누적 선금을 저장했습니다.' : '선금 정보를 삭제했습니다.')
      router.refresh()
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    save()
  }

  function clearDeposit() {
    if (!window.confirm('등록한 선금을 삭제할까요? 잔금이 발주금액 전체로 다시 계산됩니다.')) return
    save(0)
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) resetForm()
      }}
    >
      <Dialog.Trigger
        render={(props) => (
          <Button {...props} type="button" size="sm" variant="outline" className="mt-1 h-6 px-2 text-[11px]">
            <WalletCards className="size-3" />
            {item.bulkPaymentDepositCny > 0 ? '선금 수정' : '선금 등록'}
          </Button>
        )}
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold">대량결제 선금 등록</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {item.productName}{item.optionName ? ` · ${item.optionName}` : ''}
          </Dialog.Description>
          <p className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            발주금액 <span className="font-medium tabular-nums text-foreground">¥ {formatCny(totalCny)}</span>
            {item.totalCostKrw === null ? null : <span> · ₩ {formatKrw(item.totalCostKrw)}</span>}
          </p>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`bulk-payment-deposit-${item.id}`}>누적 선금 (元)</Label>
                <Input
                  id={`bulk-payment-deposit-${item.id}`}
                  inputMode="decimal"
                  value={depositCny}
                  onChange={(event) => setDepositCny(formatDecimalInput(event.target.value))}
                  className="text-right tabular-nums"
                  placeholder="0"
                  disabled={isPending}
                />
                <p className="text-[11px] text-muted-foreground">추가 지급이 있으면 누적 금액으로 수정합니다.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`bulk-payment-deposit-date-${item.id}`}>선금 지급일</Label>
                <Input
                  id={`bulk-payment-deposit-date-${item.id}`}
                  type="date"
                  value={paidAt}
                  onChange={(event) => setPaidAt(event.target.value)}
                  disabled={isPending}
                />
              </div>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <div className="flex items-center justify-between gap-3">
                <span>저장 후 잔금</span>
                <span className="font-semibold tabular-nums">¥ {formatCny(remainingCny)}</span>
              </div>
              <p className="mt-1 text-[11px] text-amber-800">원화는 이 발주에 저장된 적용환율로 자동 계산됩니다.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`bulk-payment-deposit-memo-${item.id}`}>선금 메모</Label>
              <Input
                id={`bulk-payment-deposit-memo-${item.id}`}
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                maxLength={500}
                placeholder="예: 30% 선금 지급"
                disabled={isPending}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              {item.bulkPaymentDepositCny > 0 ? (
                <Button type="button" variant="outline" onClick={clearDeposit} disabled={isPending}>
                  선금 삭제
                </Button>
              ) : null}
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
  )
}

function parseNumber(value: string) {
  return Number(value.replace(/,/g, '').trim())
}

function formatDecimal(value: number) {
  return value > 0 ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : ''
}

function formatDecimalInput(value: string) {
  const normalized = value.replace(/[^0-9.]/g, '')
  const [integer = '', ...decimalParts] = normalized.split('.')
  const formattedInteger = integer ? Number(integer).toLocaleString('ko-KR') : ''
  if (decimalParts.length === 0) return formattedInteger
  return `${formattedInteger}.${decimalParts.join('').slice(0, 2)}`
}

function formatCny(value: number) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

function formatKrw(value: number) {
  return Math.round(value).toLocaleString('ko-KR')
}

function todayKst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
