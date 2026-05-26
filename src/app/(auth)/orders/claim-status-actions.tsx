'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import type { ClaimType, ClaimStatus } from '@/lib/orders/types'

interface Props {
  claimId: string
  claimType: ClaimType
  claimStatus: ClaimStatus
  reason: string | null
  requestReason: string | null
  requestReasonRegisteredAt: string | null
  requestReasonHistory: Array<{ reason: string; registeredAt: string }>
}

const TYPE_LABELS: Record<ClaimType, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
}

const TYPE_STYLES: Record<ClaimType, string> = {
  cancel: 'border-red-300 bg-red-50 text-red-700',
  return: 'border-orange-300 bg-orange-50 text-orange-700',
  exchange: 'border-blue-300 bg-blue-50 text-blue-700',
}

const STATUS_LABELS: Record<ClaimStatus, string> = {
  requested: '접수',
  processing: '처리중',
  completed: '완료',
  rejected: '거절',
  withdrawn: '철회',
}

const STATUS_STYLES: Record<ClaimStatus, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-200 text-gray-600',
  withdrawn: 'bg-purple-100 text-purple-800',
}

const NEXT_STATES: Record<ClaimStatus, ClaimStatus[]> = {
  requested: ['processing', 'rejected'],
  processing: ['completed', 'rejected'],
  completed: [],
  rejected: [],
  withdrawn: [],
}

export function ClaimStatusActions({
  claimId,
  claimType,
  claimStatus,
  reason,
  requestReason,
  requestReasonRegisteredAt,
  requestReasonHistory,
}: Props) {
  const router = useRouter()
  const [pendingStatus, setPendingStatus] = useState<ClaimStatus | null>(null)
  const [returnItems, setReturnItems] = useState<Array<{ sku: string; quantity: number }> | null>(null)
  const [availableQuantities, setAvailableQuantities] = useState<Record<string, number>>({})
  const [defectiveQuantities, setDefectiveQuantities] = useState<Record<string, number>>({})
  const [returnItemsLoading, setReturnItemsLoading] = useState(false)
  const initialReasonHistory = requestReasonHistory.length > 0
    ? requestReasonHistory
    : requestReason && requestReasonRegisteredAt
      ? [{ reason: requestReason, registeredAt: requestReasonRegisteredAt }]
      : []
  const [requestReasonInput, setRequestReasonInput] = useState('')
  const [savedRequestReasonHistory, setSavedRequestReasonHistory] = useState(initialReasonHistory)
  const [reasonSaving, setReasonSaving] = useState(false)
  const [, startTransition] = useTransition()

  const nextStates = NEXT_STATES[claimStatus]
  const canWithdraw = claimStatus === 'requested' || claimStatus === 'processing'
  const canCompletePickup = claimStatus !== 'completed'
    && (claimType === 'return' || (claimType === 'exchange' && (reason?.includes('회수준비') || reason?.includes('접수'))))

  function formatRegisteredAt(value: string | null): string | null {
    if (!value) return null
    return format(new Date(value), 'yyyy-MM-dd HH:mm:ss')
  }

  async function saveRequestReason() {
    const nextReason = requestReasonInput.trim()
    if (!nextReason) {
      toast.error('접수 사유를 입력해주세요.')
      return
    }
    setReasonSaving(true)
    try {
      const res = await fetch(`/api/claims/${claimId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestReason: nextReason }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(error ?? '접수 사유 저장 실패')
      }
      const data = await res.json() as { reasonHistory: Array<{ reason: string; registeredAt: string }> }
      setSavedRequestReasonHistory(data.reasonHistory)
      setRequestReasonInput('')
      toast.success('접수 사유가 저장되었습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '접수 사유 저장 실패')
    } finally {
      setReasonSaving(false)
    }
  }

  useEffect(() => {
    if (!canCompletePickup) {
      setReturnItems(null)
      return
    }

    let cancelled = false
    setReturnItemsLoading(true)
    fetch(`/api/claims/${claimId}`)
      .then(async (res) => {
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? '회수 상품 조회 실패')
        }
        return res.json() as Promise<{ items?: Array<{ sku: string; quantity: number }> }>
      })
      .then((data) => {
        if (cancelled) return
        const items = data.items ?? []
        setReturnItems(items)
        setAvailableQuantities(Object.fromEntries(items.map((item) => [item.sku, item.quantity])))
        setDefectiveQuantities(Object.fromEntries(items.map((item) => [item.sku, 0])))
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : '회수 상품 조회 실패')
        }
      })
      .finally(() => {
        if (!cancelled) setReturnItemsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [canCompletePickup, claimId])

  function changeStatus(next: ClaimStatus) {
    setPendingStatus(next)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/claims/${claimId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimStatus: next }),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? 'Failed')
        }
        toast.success(`${STATUS_LABELS[next]}로 변경됨`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '상태 변경 실패')
      } finally {
        setPendingStatus(null)
      }
    })
  }

  function completeReturn() {
    const items = returnItems ?? []
    setPendingStatus('completed')
    startTransition(async () => {
      try {
        const res = await fetch(`/api/claims/${claimId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claimStatus: 'completed',
            returnCompletion: {
              quantities: items.map((item) => ({
                sku: item.sku,
                availableQuantity: Number(availableQuantities[item.sku] ?? 0),
                defectiveQuantity: Number(defectiveQuantities[item.sku] ?? 0),
              })),
            },
          }),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? '회수완료 실패')
        }
        toast.success(claimType === 'exchange' ? '교환회수완료 처리됨' : '반품회수완료 처리됨')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '회수완료 실패')
      } finally {
        setPendingStatus(null)
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Badge variant="outline" className={`text-xs ${TYPE_STYLES[claimType]}`}>
          {TYPE_LABELS[claimType]}
        </Badge>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[claimStatus]}`}>
          {STATUS_LABELS[claimStatus]}
        </span>
      </div>
      <div className="mt-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="mb-2 text-[11px] font-medium text-muted-foreground">접수 사유 이력</div>
        {savedRequestReasonHistory.length === 0 ? (
          <div className="text-sm text-foreground">등록된 접수 사유가 없습니다.</div>
        ) : (
          <div className="space-y-2">
            {savedRequestReasonHistory.map((entry, index) => (
              <div key={`${entry.registeredAt}-${index}`} className="rounded border bg-white px-2.5 py-2">
                <div className="mb-1 text-[11px] text-muted-foreground">
                  {formatRegisteredAt(entry.registeredAt)}
                </div>
                <div className="whitespace-pre-wrap break-words text-sm text-foreground">{entry.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 space-y-2">
        <textarea
          value={requestReasonInput}
          onChange={(event) => setRequestReasonInput(event.target.value)}
          placeholder="접수 사유를 입력하세요."
          className="h-20 w-full resize-none rounded-md border px-3 py-2 text-sm"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={saveRequestReason}
            disabled={reasonSaving}
            className="rounded border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {reasonSaving ? '저장 중' : '접수 사유 저장'}
          </button>
        </div>
      </div>
      {(nextStates.length > 0 || canWithdraw) && (
        <div className="flex gap-1">
          {nextStates.map((next) => (
            <button
              key={next}
              type="button"
              onClick={() => changeStatus(next)}
              disabled={pendingStatus !== null}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
                next === 'rejected'
                  ? 'border-red-300 text-red-700 hover:bg-red-50'
                  : 'border-primary/40 text-primary hover:bg-primary/10'
              }`}
            >
              → {STATUS_LABELS[next]}
            </button>
          ))}
          {canWithdraw && (
            <button
              type="button"
              onClick={() => changeStatus('withdrawn')}
              disabled={pendingStatus !== null}
              className="rounded border border-purple-300 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 transition-colors hover:bg-purple-50 disabled:opacity-50"
            >
              철회
            </button>
          )}
        </div>
      )}
      {canCompletePickup && (
        <div className="mt-3 rounded-md border p-3">
          <h4 className="mb-2 text-sm font-semibold">{claimType === 'exchange' ? '교환회수완료 처리' : '반품회수완료 처리'}</h4>
          <div className="max-h-64 overflow-auto rounded border">
            {returnItemsLoading ? (
              <div className="p-3 text-sm text-muted-foreground">회수 상품을 불러오는 중입니다.</div>
            ) : (returnItems ?? []).length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">회수 처리할 매핑 상품이 없습니다.</div>
            ) : (
              (returnItems ?? []).map((item) => (
                <div key={item.sku} className="grid grid-cols-[1fr_78px_78px] items-end gap-2 border-b p-2 last:border-b-0">
                  <div>
                    <div className="font-mono text-xs">{item.sku}</div>
                    <div className="text-[11px] text-muted-foreground">최대 {item.quantity}개</div>
                  </div>
                  <label className="text-[11px] font-medium text-green-700">
                    가용
                    <input
                      type="number"
                      min={0}
                      max={item.quantity}
                      value={availableQuantities[item.sku] ?? 0}
                      onChange={(event) => setAvailableQuantities((prev) => ({
                        ...prev,
                        [item.sku]: Number(event.target.value),
                      }))}
                      className="mt-1 h-8 w-full rounded border px-2 text-right text-sm text-foreground"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-red-700">
                    불용
                    <input
                      type="number"
                      min={0}
                      max={item.quantity}
                      value={defectiveQuantities[item.sku] ?? 0}
                      onChange={(event) => setDefectiveQuantities((prev) => ({
                        ...prev,
                        [item.sku]: Number(event.target.value),
                      }))}
                      className="mt-1 h-8 w-full rounded border px-2 text-right text-sm text-foreground"
                    />
                  </label>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={completeReturn}
              disabled={pendingStatus !== null || returnItemsLoading || (returnItems ?? []).length === 0}
              className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              회수완료 처리
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
