'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

const PRESETS = [
  '미발송장 보유중',
  '출고 전 취소요청건',
  '경동택배 미발건',
  '미발송장 보유중 / 회수입고 검수 후 출고 예정',
  '국내배송상품',
  '송장분실 예상',
  '파업반송',
  'TODO 확인요청',
  '배송불가지역',
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedOrderIds: string[]
}

export function LogisticsMessageDialog({ open, onOpenChange, selectedOrderIds }: Props) {
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<'set' | 'clear'>('set')
  const [isPending, startTransition] = useTransition()

  if (!open) return null

  function handleSave() {
    if (selectedOrderIds.length === 0) {
      toast.error('주문을 선택하세요')
      return
    }
    if (mode === 'set' && !message.trim()) {
      toast.error('메시지를 선택하거나 입력하세요')
      return
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/orders/bulk/logistics-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderIds: selectedOrderIds,
            message: mode === 'clear' ? null : message.trim(),
          }),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? 'Failed')
        }
        const { updated } = await res.json()
        toast.success(
          mode === 'clear'
            ? `${updated}건 물류메세지 해제됨`
            : `${updated}건 물류메세지 설정됨`,
        )
        setMessage('')
        onOpenChange(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '저장 실패')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">물류메세지 세팅/해제</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 text-sm">
          <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
            선택된 주문: <span className="font-bold">{selectedOrderIds.length}건</span>
          </div>

          {/* Mode selector */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              구분
            </label>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'set'}
                  onChange={() => setMode('set')}
                />
                세팅
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'clear'}
                  onChange={() => setMode('clear')}
                />
                해제
              </label>
            </div>
          </div>

          {/* Message selector (only when setting) */}
          {mode === 'set' && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-muted-foreground">
                메세지 선택
              </label>
              <select
                value={PRESETS.includes(message) ? message : ''}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-md border px-2 py-1.5 text-sm"
              >
                <option value="">— 프리셋에서 선택 —</option>
                {PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="직접 입력 가능"
                className="w-full rounded-md border px-2 py-1.5 text-sm"
              />
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || selectedOrderIds.length === 0}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
