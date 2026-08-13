'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Upload } from 'lucide-react'

export function ChannelSalesActions() {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleUpload(formData: FormData) {
    setUploading(true)
    setMessage(null)
    try {
      const response = await fetch('/api/analytics/channel-sales/import', {
        method: 'POST',
        body: formData,
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? '매출 파일 업로드에 실패했습니다.')

      const summary = body.skipped
        ? '같은 채널에 같은 파일이 이미 등록되어 기존 데이터를 유지했습니다.'
        : `등록 완료: ${Number(body.validRows ?? 0).toLocaleString('ko-KR')}행, 수량 ${Number(body.totalQuantity ?? 0).toLocaleString('ko-KR')}개, 매출 ${formatWon(Number(body.totalSales ?? 0))}`
      const warnings = Array.isArray(body.warnings) && body.warnings.length > 0
        ? ` ${body.warnings.join(' ')}`
        : ''
      setMessage(`${summary}${warnings}`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '매출 파일 업로드에 실패했습니다.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <form action={handleUpload} className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">매출 구분</span>
          <select
            name="channel"
            defaultValue="bulk"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="bulk">대량</option>
            <option value="rocket">로켓배송</option>
          </select>
        </label>
        <label className="min-w-0 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">매출 파일 (.xlsx, .csv)</span>
          <input
            type="file"
            name="file"
            accept=".xlsx,.csv"
            required
            className="h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={uploading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Upload className="size-4" />
          {uploading ? '매출 등록 중' : '매출 등록'}
        </button>
      </form>
      <p className="text-xs leading-5 text-muted-foreground">
        주문번호 없이 등록할 수 있습니다. 매출일, 상품코드 또는 상품명, 수량, 총 판매금액 또는 개당 판매가를 읽으며,
        원가총액과 마진금액이 있으면 파일 값을 그대로 반영합니다. 이 업로드는 주문·출고·재고·발주수량을 변경하지 않습니다.
      </p>
      {message ? <div className="rounded-md bg-muted px-3 py-2 text-sm">{message}</div> : null}
    </div>
  )
}

function formatWon(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}
