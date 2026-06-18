'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CheckCircle2, Upload } from 'lucide-react'

type Option = {
  id: string
  label: string
}

export function SabangnetReviewActions({
  marketplaces,
  templates,
  selectedBatchId,
  readyRows,
}: {
  marketplaces: Option[]
  templates: Option[]
  selectedBatchId?: string
  readyRows: number
}) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleUpload(formData: FormData) {
    setUploading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/analytics/sabangnet-review/import', {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '업로드에 실패했습니다.')
      setMessage(`검수 등록 완료: 전체 ${json.totalRows ?? 0}건, 정상 ${json.readyRows ?? 0}건, 보류 ${json.blockedRows ?? 0}건`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업로드에 실패했습니다.')
    } finally {
      setUploading(false)
    }
  }

  async function handleConfirm() {
    if (!selectedBatchId || readyRows <= 0) return
    setConfirming(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/analytics/sabangnet-review/${selectedBatchId}/confirm`, {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '확정 반영에 실패했습니다.')
      const confirmed = Number(json.confirmed ?? 0).toLocaleString('ko-KR')
      const excluded = Number(json.excluded ?? 0).toLocaleString('ko-KR')
      setMessage(`정상/교환 주문 ${confirmed}건을 확정 반영하고, 취소/반품 ${excluded}건은 매출 제외 처리했습니다.`)
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '확정 반영에 실패했습니다.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <form action={handleUpload} className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">사방넷 주문 엑셀</span>
          <input
            type="file"
            name="file"
            accept=".xlsx"
            required
            className="h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">마켓</span>
          <select name="marketplaceId" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">파일 기준 자동 매칭</option>
            {marketplaces.map((marketplace) => (
              <option key={marketplace.id} value={marketplace.id}>{marketplace.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">주문 업로드 양식</span>
          <select name="templateId" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">자동 선택</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.label}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={uploading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Upload className="size-4" />
          {uploading ? '검수 등록 중' : '검수 등록'}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          정상 행만 확정 반영합니다. 문제 행은 보류 상태로 남기고 사유를 확인할 수 있습니다.
        </p>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!selectedBatchId || readyRows <= 0 || confirming}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <CheckCircle2 className="size-4" />
          {confirming ? '확정 반영 중' : `정상 ${readyRows.toLocaleString('ko-KR')}건 확정`}
        </button>
      </div>

      {message ? <div className="rounded-md bg-muted px-3 py-2 text-sm">{message}</div> : null}
    </div>
  )
}
