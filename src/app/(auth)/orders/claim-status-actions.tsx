'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import type { ClaimType, ClaimStatus } from '@/lib/orders/types'

interface Props {
  claimId: string
  claimType: ClaimType
  claimStatus: ClaimStatus
  reason: string | null
  requestReason: string | null
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

export function ClaimStatusActions({ claimId, claimType, claimStatus, reason, requestReason }: Props) {
  const router = useRouter()
  const [pendingStatus, setPendingStatus] = useState<ClaimStatus | null>(null)
  const [returnItems, setReturnItems] = useState<Array<{ sku: string; quantity: number }> | null>(null)
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({})
  const [returnDisposition, setReturnDisposition] = useState<'available' | 'defective'>('available')
  const [returnModalOpen, setReturnModalOpen] = useState(false)
  const [, startTransition] = useTransition()

  const nextStates = NEXT_STATES[claimStatus]
  const canWithdraw = claimStatus === 'requested' || claimStatus === 'processing'

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

  function openReturnComplete() {
    setPendingStatus('completed')
    startTransition(async () => {
      try {
        const res = await fetch(`/api/claims/${claimId}`)
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? '회수 상품 조회 실패')
        }
        const data = await res.json() as { items?: Array<{ sku: string; quantity: number }> }
        const items = data.items ?? []
        setReturnItems(items)
        setReturnQuantities(Object.fromEntries(items.map((item) => [item.sku, item.quantity])))
        setReturnDisposition('available')
        setReturnModalOpen(true)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '회수 상품 조회 실패')
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
              disposition: returnDisposition,
              quantities: items.map((item) => ({
                sku: item.sku,
                quantity: Number(returnQuantities[item.sku] ?? 0),
              })),
            },
          }),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? '회수완료 실패')
        }
        toast.success(claimType === 'exchange' ? '교환회수완료 처리됨' : '반품회수완료 처리됨')
        setReturnModalOpen(false)
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
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">접수 사유</div>
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {requestReason || '등록된 접수 사유가 없습니다.'}
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
          {(claimType === 'return' || (claimType === 'exchange' && reason?.includes('회수준비'))) && claimStatus !== 'completed' && (
            <button
              type="button"
              onClick={openReturnComplete}
              disabled={pendingStatus !== null}
              className="rounded border border-green-300 px-1.5 py-0.5 text-[10px] font-medium text-green-700 transition-colors hover:bg-green-50 disabled:opacity-50"
            >
              {claimType === 'exchange' ? '교환회수완료' : '반품회수완료'}
            </button>
          )}
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
      {returnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-3">
              <h3 className="text-base font-semibold">{claimType === 'exchange' ? '교환회수완료 처리' : '반품회수완료 처리'}</h3>
            </div>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setReturnDisposition('available')}
                className={`rounded border px-3 py-1 text-sm ${returnDisposition === 'available' ? 'border-green-500 bg-green-50 text-green-700' : ''}`}
              >
                가용
              </button>
              <button
                type="button"
                onClick={() => setReturnDisposition('defective')}
                className={`rounded border px-3 py-1 text-sm ${returnDisposition === 'defective' ? 'border-red-500 bg-red-50 text-red-700' : ''}`}
              >
                불용
              </button>
            </div>
            <div className="max-h-64 overflow-auto rounded border">
              {(returnItems ?? []).length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">회수 처리할 매핑 상품이 없습니다.</div>
              ) : (
                (returnItems ?? []).map((item) => (
                  <div key={item.sku} className="grid grid-cols-[1fr_88px] items-center gap-2 border-b p-2 last:border-b-0">
                    <div>
                      <div className="font-mono text-xs">{item.sku}</div>
                      <div className="text-[11px] text-muted-foreground">최대 {item.quantity}개</div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={item.quantity}
                      value={returnQuantities[item.sku] ?? 0}
                      onChange={(event) => setReturnQuantities((prev) => ({
                        ...prev,
                        [item.sku]: Number(event.target.value),
                      }))}
                      className="h-8 rounded border px-2 text-right text-sm"
                    />
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReturnModalOpen(false)}
                className="rounded border px-3 py-1.5 text-sm"
              >
                취소
              </button>
              <button
                type="button"
                onClick={completeReturn}
                disabled={pendingStatus !== null || (returnItems ?? []).length === 0}
                className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
