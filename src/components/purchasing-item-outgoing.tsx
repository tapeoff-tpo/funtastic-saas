'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { Save, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type ImportResult = { total: number; imported: number; skipped: number }

export function PurchasingItemOutgoingUpload() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function upload() {
    const file = inputRef.current?.files?.[0]
    if (!file) {
      toast.error('출고수량 엑셀 파일을 선택해주세요.')
      return
    }
    startTransition(async () => {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch('/api/purchasing/items/outgoing/import', { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? '출고수량 업로드에 실패했습니다.')
        return
      }
      setResult(body)
      toast.success(`${body.imported.toLocaleString('ko-KR')}개 품목의 출고수량을 반영했습니다.`)
      if (inputRef.current) inputRef.current.value = ''
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="h-9 max-w-72 rounded-md border bg-background px-2 py-1 text-sm" />
      <Button type="button" variant="outline" onClick={upload} disabled={isPending}>
        <Upload className="size-4" />
        {isPending ? '반영 중' : '출고수량 업로드'}
      </Button>
      {result ? (
        <span className="text-xs text-muted-foreground">
          전체 {result.total.toLocaleString('ko-KR')} / 반영 {result.imported.toLocaleString('ko-KR')} / 제외 {result.skipped.toLocaleString('ko-KR')}
        </span>
      ) : null}
    </div>
  )
}

export function PurchasingItemOutgoingFields({
  productId,
  currentMonthOutgoing,
  threeMonthAverageOutgoing,
}: {
  productId: string
  currentMonthOutgoing: number
  threeMonthAverageOutgoing: number
}) {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      const response = await fetch(`/api/purchasing/items/${productId}/outgoing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentMonthOutgoing: Number(formData.get('currentMonthOutgoing') ?? 0),
          threeMonthAverageOutgoing: Number(formData.get('threeMonthAverageOutgoing') ?? 0),
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        setMessage(body.error ?? '저장 실패')
        return
      }
      setMessage('저장됨')
      router.refresh()
    })
  }

  return (
    <form onSubmit={save} className="flex min-w-[300px] items-center gap-1">
      <input
        name="currentMonthOutgoing"
        type="number"
        min="0"
        step="0.1"
        defaultValue={currentMonthOutgoing}
        className="h-8 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums"
        aria-label="당월 출고수량"
      />
      <input
        name="threeMonthAverageOutgoing"
        type="number"
        min="0"
        step="0.1"
        defaultValue={threeMonthAverageOutgoing}
        className="h-8 w-28 rounded-md border bg-background px-2 text-right text-sm tabular-nums"
        aria-label="3개월 평균 출고수량"
      />
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        <Save className="size-4" />
        {message ?? '저장'}
      </Button>
    </form>
  )
}
