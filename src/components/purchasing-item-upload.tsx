'use client'

import { useRef, useState, useTransition } from 'react'
import { Download, Upload } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type ImportResult = { total: number; imported: number; skipped: number }

export function PurchasingItemUpload() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function upload() {
    const file = inputRef.current?.files?.[0]
    if (!file) {
      toast.error('ESA009M 엑셀 파일을 선택해주세요.')
      return
    }
    startTransition(async () => {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch('/api/purchasing/items/import', { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok) {
        toast.error(body.error ?? '품목 업로드에 실패했습니다.')
        return
      }
      setResult(body)
      toast.success(`${body.imported.toLocaleString('ko-KR')}개 품목을 반영했습니다.`)
      if (inputRef.current) inputRef.current.value = ''
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href="/api/purchasing/items/export"
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
      >
        <Download className="size-4" />
        엑셀 다운로드
      </Link>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="h-9 max-w-72 rounded-md border bg-background px-2 py-1 text-sm" />
      <Button type="button" onClick={upload} disabled={isPending}>
        <Upload className="size-4" />
        {isPending ? '반영 중' : '파일 업로드'}
      </Button>
      {result ? (
        <span className="text-xs text-muted-foreground">
          전체 {result.total.toLocaleString('ko-KR')} / 반영 {result.imported.toLocaleString('ko-KR')} / 제외 {result.skipped.toLocaleString('ko-KR')}
        </span>
      ) : null}
    </div>
  )
}
