'use client'

import { useRef, useState, useTransition } from 'react'
import { Download, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type ImportResult = {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

export function ChannelBundleOverridesUpload() {
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error('업로드할 채널 묶음상품 파일을 선택해주세요.')
      return
    }
    startTransition(async () => {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch('/api/analytics/price-table/channel-overrides/import', { method: 'POST', body: form })
      const body = await response.json() as ImportResult & { error?: string }
      if (!response.ok) {
        toast.error(body.error ?? '채널 묶음상품 업로드에 실패했습니다.')
        return
      }
      setResult(body)
      toast.success(`묶음상품 ${body.created}건 등록, ${body.updated}건 갱신했습니다.`)
      if (body.errors.length) toast.warning(`${body.skipped}건은 형식을 확인해주세요.`)
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    })
  }

  return (
    <details className="group border-b bg-muted/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className="font-medium">채널 묶음상품 엑셀 등록</span>
        <span className="text-xs text-muted-foreground">원본 판매가 파일과 별도로 저장됩니다.</span>
      </summary>
      <div className="grid gap-3 border-t px-4 py-3">
        <p className="text-xs leading-5 text-muted-foreground">
          같은 채널·상품 ID·묶음 SKU는 갱신하고, 없는 행은 새로 등록합니다. 원본 SKU는 여러 개면 <code>SKU*수량, SKU*수량</code> 형식으로 입력합니다.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm" />
          <div className="flex gap-2">
            <Button type="button" variant="outline" asChild>
              <a href="/api/analytics/price-table/channel-overrides/import"><Download />템플릿</a>
            </Button>
            <Button type="button" onClick={upload} disabled={isPending}>
              <Upload />{isPending ? '등록 중' : '일괄 등록'}
            </Button>
          </div>
        </div>
        {result ? (
          <div className="text-xs text-muted-foreground">
            등록 {result.created}건, 갱신 {result.updated}건{result.skipped ? `, 제외 ${result.skipped}건` : ''}
            {result.errors.length ? <div className="mt-1 text-destructive">{result.errors.slice(0, 3).join(' / ')}</div> : null}
          </div>
        ) : null}
      </div>
    </details>
  )
}
