'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Upload } from 'lucide-react'

export function RocketOutboundActions() {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleUpload(formData: FormData) {
    setUploading(true)
    setMessage(null)
    try {
      const response = await fetch('/api/analytics/rocket-outbound/import', {
        method: 'POST',
        body: formData,
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? '업로드에 실패했습니다.')

      const summary = body.skipped
        ? '이미 같은 파일이 등록되어 있어 기존 데이터를 그대로 사용합니다.'
        : `등록 완료: 전체 ${Number(body.totalRows ?? 0).toLocaleString('ko-KR')}행, 품목 매칭 ${Number(body.matchedRows ?? 0).toLocaleString('ko-KR')}행, 미매칭 ${Number(body.unmatchedRows ?? 0).toLocaleString('ko-KR')}행`
      const warnings = Array.isArray(body.warnings) && body.warnings.length > 0
        ? ` ${body.warnings.join(' ')}`
        : ''
      setMessage(`${summary}${warnings}`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업로드에 실패했습니다.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <form action={handleUpload} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">쿠팡 로켓배송 출고 엑셀</span>
          <input
            type="file"
            name="file"
            accept=".xlsx"
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
          {uploading ? '출고 등록 중' : '출고 등록'}
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        출고일·수량·상품코드 또는 상품명이 있는 파일을 등록합니다. 암호 보호 파일은 암호를 해제해 .xlsx로 저장한 뒤 등록해 주세요.
      </p>
      {message ? <div className="rounded-md bg-muted px-3 py-2 text-sm">{message}</div> : null}
    </div>
  )
}
