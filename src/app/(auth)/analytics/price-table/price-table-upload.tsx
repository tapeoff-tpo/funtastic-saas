'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type ImportResult = {
  imported: number
  sheets: Array<{ name: string; rows: number }>
  sourceFileName: string
}

export function PriceTableUpload() {
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error('업로드할 판매가 테이블 파일을 선택해주세요.')
      return
    }

    startTransition(async () => {
      const form = new FormData()
      form.set('file', file)

      const response = await fetch('/api/analytics/price-table/import', {
        method: 'POST',
        body: form,
      })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? '판매가 테이블 업로드에 실패했습니다.')
        return
      }

      setResult(body)
      toast.success(`판매가 테이블 ${body.imported.toLocaleString('ko-KR')}건을 반영했습니다.`)
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">판매가 테이블 업로드</h2>
        <p className="text-sm text-muted-foreground">
          상품등록, 메인, 뉴도매 시트의 상품코드와 플랫폼별 판매가 원본 데이터를 분석 화면에 반영합니다.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsb,.xlsx,.xls"
          className="h-9 rounded-lg border bg-background px-2 py-1 text-sm"
        />
        <Button type="button" onClick={upload} disabled={isPending}>
          <Upload />
          {isPending ? '업로드 중' : '업로드'}
        </Button>
      </div>

      {result ? (
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <ResultBox label="전체 반영" value={result.imported} />
          {result.sheets.map((sheet) => (
            <ResultBox key={sheet.name} label={sheet.name} value={sheet.rows} />
          ))}
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
