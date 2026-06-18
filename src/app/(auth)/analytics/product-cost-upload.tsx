'use client'

import { useRef, useState, useTransition } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type ImportResult = {
  totalRows: number
  updated: number
  unchanged: number
  unmatched: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

export function ProductCostUpload() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error('원가 엑셀 파일을 선택해주세요.')
      return
    }

    startTransition(async () => {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch('/api/analytics/product-costs/import', { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? '원가 업로드에 실패했습니다.')
        return
      }

      setResult(body)
      toast.success(`상품 원가 ${body.updated.toLocaleString('ko-KR')}건을 반영했습니다.`)
      if (fileRef.current) fileRef.current.value = ''
    })
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">상품 원가 업로드</h2>
        <p className="text-sm text-muted-foreground">
          A열 품목코드를 내부상품코드와 매칭하고 N열 원가를 상품 원가로 반영합니다.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="h-8 rounded-lg border bg-background px-2 py-1 text-sm" />
        <Button type="button" onClick={upload} disabled={isPending}>
          <Upload />
          {isPending ? '업로드 중' : '업로드'}
        </Button>
      </div>

      {result ? (
        <div className="grid gap-2 text-sm sm:grid-cols-5">
          <ResultBox label="읽은 행" value={result.totalRows} />
          <ResultBox label="원가 변경" value={result.updated} />
          <ResultBox label="변경 없음" value={result.unchanged} />
          <ResultBox label="미매칭" value={result.unmatched} />
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
