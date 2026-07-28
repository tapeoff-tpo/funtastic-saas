'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { CheckCircle2, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

type Option = {
  id: string
  label: string
}

type ImportResponse = {
  batchId?: string | null
  totalRows?: number
  readyRows?: number
  blockedRows?: number
  errors?: unknown[]
  error?: string
}

type ConfirmResponse = {
  confirmed?: number
  excluded?: number
  readyRows?: number
  done?: boolean
  error?: string
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
  const uploadInFlightRef = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleUpload(formData: FormData) {
    if (uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    setUploading(true)
    setMessage('검수 파일을 업로드하고 있습니다. 파일이 크면 1~3분 정도 걸릴 수 있습니다.')
    toast.loading('사방넷 검수등록 중입니다.', { id: 'sabangnet-review-upload' })

    try {
      const file = formData.get('file')
      if (!(file instanceof File) || file.size === 0) {
        throw new Error('업로드할 엑셀 파일을 선택해주세요.')
      }

      const res = await fetch('/api/analytics/sabangnet-review/import', {
        method: 'POST',
        body: formData,
      })
      const json = await readJson<ImportResponse>(res)
      if (!res.ok) throw new Error(json.error ?? '검수등록에 실패했습니다.')

      const summary = `검수등록 완료: 전체 ${(json.totalRows ?? 0).toLocaleString('ko-KR')}건, 정상 ${(json.readyRows ?? 0).toLocaleString('ko-KR')}건, 보류 ${(json.blockedRows ?? 0).toLocaleString('ko-KR')}건`
      setMessage(summary)
      toast.success(summary, { id: 'sabangnet-review-upload' })

      if (json.batchId) {
        router.push(`/analytics/sabangnet-review?batch=${json.batchId}`)
      }
      router.refresh()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '검수등록에 실패했습니다.'
      setMessage(errorMessage)
      toast.error(errorMessage, { id: 'sabangnet-review-upload' })
    } finally {
      uploadInFlightRef.current = false
      setUploading(false)
    }
  }

  async function handleConfirm() {
    if (!selectedBatchId || readyRows <= 0 || confirming) return
    setConfirming(true)
    setMessage('정상 건을 확정 반영하고 있습니다.')
    toast.loading('사방넷 주문 확정 반영 중입니다.', { id: 'sabangnet-review-confirm' })

    try {
      let totalConfirmed = 0
      let totalExcluded = 0
      let remaining = readyRows

      for (let step = 1; step <= 100 && remaining > 0; step += 1) {
        setMessage(`확정 처리 중입니다. 남은 정상 건: ${remaining.toLocaleString('ko-KR')}건`)
        const res = await fetch(`/api/analytics/sabangnet-review/${selectedBatchId}/confirm?limit=500`, {
          method: 'POST',
        })
        const json = await readJson<ConfirmResponse>(res)
        if (!res.ok) throw new Error(json.error ?? '확정 반영에 실패했습니다.')
        totalConfirmed += Number(json.confirmed ?? 0)
        totalExcluded += Number(json.excluded ?? 0)
        remaining = Number(json.readyRows ?? 0)
        if (json.done) break
      }

      const summary = `확정 반영 완료: 주문 ${totalConfirmed.toLocaleString('ko-KR')}건, 매출 제외 ${totalExcluded.toLocaleString('ko-KR')}건`
      setMessage(summary)
      toast.success(summary, { id: 'sabangnet-review-confirm' })
      router.refresh()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '확정 반영에 실패했습니다.'
      setMessage(errorMessage)
      toast.error(errorMessage, { id: 'sabangnet-review-confirm' })
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4" aria-busy={uploading || confirming}>
      <form action={handleUpload} className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">사방넷 주문 엑셀</span>
          <input
            type="file"
            name="file"
            accept=".xlsx"
            required
            disabled={uploading}
            className="h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">마켓</span>
          <select
            name="marketplaceId"
            disabled={uploading}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">파일 기준 자동 매칭</option>
            {marketplaces.map((marketplace) => (
              <option key={marketplace.id} value={marketplace.id}>{marketplace.label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">주문 업로드 양식</span>
          <select
            name="templateId"
            disabled={uploading}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">자동 선택</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.label}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={uploading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {uploading ? '검수등록 중...' : '검수등록'}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          정상 건만 확정 반영합니다. 보류 건은 수정 후 다시 검수 상태가 갱신됩니다.
        </p>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!selectedBatchId || readyRows <= 0 || confirming || uploading}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {confirming ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {confirming ? '확정 반영 중...' : `정상 ${readyRows.toLocaleString('ko-KR')}건 확정`}
        </button>
      </div>

      {message ? <div className="rounded-md bg-muted px-3 py-2 text-sm">{message}</div> : null}
    </div>
  )
}

async function readJson<T extends { error?: string }>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    return { error: '서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.' } as T
  }
}
