'use client'

import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

const CLAIM_STATUS_FLOW: Record<string, string[]> = {
  requested: ['processing', 'rejected'],
  processing: ['completed', 'rejected'],
  completed: [],
  rejected: [],
}

interface ClaimListProps {
  claims: Array<{
    id: string
    claimType: string
    claimStatus: string
    reason: string | null
    requestedAt: string
  }>
  typeLabels: Record<string, string>
  statusLabels: Record<string, string>
}

function ClaimList({ claims, typeLabels, statusLabels }: ClaimListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)

  function changeStatus(claimId: string, nextStatus: string) {
    setPendingId(claimId)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/claims/${claimId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimStatus: nextStatus }),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? 'Failed')
        }
        toast.success(`상태 변경됨: ${statusLabels[nextStatus]}`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '상태 변경 실패')
      } finally {
        setPendingId(null)
      }
    })
  }

  return (
    <ul className="space-y-3">
      {claims.map((c) => (
        <li key={c.id} className="rounded-md border p-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="rounded border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                {typeLabels[c.claimType] ?? c.claimType}
              </span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">
                {statusLabels[c.claimStatus] ?? c.claimStatus}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {format(new Date(c.requestedAt), 'yyyy-MM-dd HH:mm')}
            </span>
          </div>
          {c.reason && <p className="text-muted-foreground">{c.reason}</p>}
          {CLAIM_STATUS_FLOW[c.claimStatus]?.length > 0 && (
            <div className="mt-3 flex gap-2">
              {CLAIM_STATUS_FLOW[c.claimStatus].map((next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => changeStatus(c.id, next)}
                  disabled={isPending && pendingId === c.id}
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                    next === 'rejected'
                      ? 'border-red-300 text-red-700 hover:bg-red-50'
                      : 'border-primary/40 text-primary hover:bg-primary/10'
                  }`}
                >
                  {statusLabels[next] ?? next}
                </button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

interface MemoPanelProps {
  orderId: string
  initialMemos: Array<{
    id: string
    content: string
    memoType: string
    createdAt: string
  }>
}

function MemoPanel({ orderId, initialMemos }: MemoPanelProps) {
  const [memos, setMemos] = useState(initialMemos)
  const [content, setContent] = useState('')
  const [memoType, setMemoType] = useState('general')
  const [isPending, startTransition] = useTransition()

  function submit() {
    const trimmed = content.trim()
    if (!trimmed) {
      toast.error('메모 내용을 입력하세요')
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/memos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed, memoType }),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? 'Failed')
        }
        const { memo } = await res.json()
        setMemos([{ ...memo, createdAt: memo.createdAt }, ...memos])
        setContent('')
        toast.success('메모 추가됨')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '메모 추가 실패')
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Add form */}
      <div className="space-y-2">
        <select
          value={memoType}
          onChange={(e) => setMemoType(e.target.value)}
          className="w-full rounded-md border px-2 py-1 text-sm"
        >
          <option value="general">일반</option>
          <option value="cs">CS 문의</option>
          <option value="cancel">취소</option>
          <option value="return">반품</option>
          <option value="exchange">교환</option>
        </select>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="메모 내용..."
          rows={3}
          className="w-full rounded-md border px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !content.trim()}
          className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? '추가 중...' : '메모 추가'}
        </button>
      </div>

      {/* List */}
      <div className="max-h-96 space-y-2 overflow-y-auto border-t pt-3">
        {memos.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            메모가 없습니다
          </p>
        ) : (
          memos.map((m) => (
            <div key={m.id} className="rounded-md border bg-muted/30 p-2 text-sm">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="rounded bg-white px-1.5 py-0.5 font-medium">
                  {m.memoType}
                </span>
                <span>{format(new Date(m.createdAt), 'MM-dd HH:mm')}</span>
              </div>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export { ClaimList, MemoPanel }
