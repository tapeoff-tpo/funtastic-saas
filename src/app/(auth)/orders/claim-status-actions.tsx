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
}

const STATUS_STYLES: Record<ClaimStatus, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-200 text-gray-600',
}

const NEXT_STATES: Record<ClaimStatus, ClaimStatus[]> = {
  requested: ['processing', 'rejected'],
  processing: ['completed', 'rejected'],
  completed: [],
  rejected: [],
}

export function ClaimStatusActions({ claimId, claimType, claimStatus, reason }: Props) {
  const router = useRouter()
  const [pendingStatus, setPendingStatus] = useState<ClaimStatus | null>(null)
  const [, startTransition] = useTransition()

  const nextStates = NEXT_STATES[claimStatus]

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
      {reason && (
        <span className="max-w-[180px] truncate text-xs text-muted-foreground" title={reason}>
          {reason}
        </span>
      )}
      {nextStates.length > 0 && (
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
        </div>
      )}
    </div>
  )
}
