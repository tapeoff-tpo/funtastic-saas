'use client'

import { useRef, useState, useTransition } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type ProductCostUploadResult = {
  total: number
  updated: number
  inserted: number
  skipped: number
  message?: string
}

export function ProductCostUpload() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ProductCostUploadResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error('원가 파일을 선택해주세요.')
      return
    }

    startTransition(async () => {
      const form = new FormData()
      form.set('file', file)

      try {
        const response = await fetch('/api/products/bulk-update', {
          method: 'POST',
          body: form,
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          toast.error(body.error ?? '원가파일 업데이트에 실패했습니다.')
          return
        }

        setResult(body)
        toast.success(body.message ?? `원가 ${body.updated ?? 0}건을 업데이트했습니다.`)
        if (fileRef.current) fileRef.current.value = ''
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '원가파일 업데이트 요청에 실패했습니다.')
      }
    })
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">상품 원가파일 업데이트</h2>
        <p className="text-sm text-muted-foreground">
          엑셀의 품목코드로 상품을 찾아 원가를 일괄 반영합니다.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="h-8 rounded-lg border bg-background px-2 py-1 text-sm"
        />
        <Button type="button" onClick={upload} disabled={isPending}>
          <Upload />
          {isPending ? '업데이트 중' : '원가 업데이트'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        기본 양식: 품목코드, 품목명, works 신규 원가, works 기존 원가
      </p>

      {result ? (
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <ResultBox label="읽은 행" value={result.total} />
          <ResultBox label="업데이트" value={result.updated} />
          <ResultBox label="신규 추가" value={result.inserted} />
          <ResultBox label="제외" value={result.skipped} />
        </div>
      ) : null}
    </div>
  )
}

function ResultBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value.toLocaleString('ko-KR')}</div>
    </div>
  )
}
