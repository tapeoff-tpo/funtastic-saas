'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

type Option = { id: string; label: string }

type ImportResponse = {
  batchId?: string | null
  skipped?: boolean
  totalRows?: number
  readyRows?: number
  blockedRows?: number
  error?: string
}

type ApplyResponse = {
  applied?: number
  excluded?: number
  readyRows?: number
  done?: boolean
  error?: string
}

export function OutboundReflectionActions({
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
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleUpload(formData: FormData) {
    if (uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    setUploading(true)
    setMessage('사방넷 검수 파일을 출고반영 대기열로 읽고 있습니다.')
    try {
      const file = formData.get('file')
      if (!(file instanceof File) || file.size === 0) throw new Error('업로드할 엑셀 파일을 선택해주세요.')
      const response = await fetch('/api/outbound-reflection/import', { method: 'POST', body: formData })
      const json = await readJson<ImportResponse>(response)
      if (!response.ok) throw new Error(json.error ?? '출고반영 파일 업로드에 실패했습니다.')
      const summary = json.skipped
        ? '같은 파일이 이미 등록되어 기존 대기열을 열었습니다.'
        : `대기열 등록: 전체 ${(json.totalRows ?? 0).toLocaleString('ko-KR')}건, 반영 대기 ${(json.readyRows ?? 0).toLocaleString('ko-KR')}건, 확인 필요 ${(json.blockedRows ?? 0).toLocaleString('ko-KR')}건`
      setMessage(summary)
      toast.success(summary)
      if (json.batchId) router.push(`/outbound-reflection?batch=${json.batchId}`)
      router.refresh()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '출고반영 파일 업로드에 실패했습니다.'
      setMessage(errorMessage)
      toast.error(errorMessage)
    } finally {
      uploadInFlightRef.current = false
      setUploading(false)
    }
  }

  async function handleApply() {
    if (!selectedBatchId || readyRows <= 0 || applying) return
    setApplying(true)
    let remaining = readyRows
    let totalApplied = 0
    let totalExcluded = 0
    try {
      for (let step = 0; step < 100 && remaining > 0; step += 1) {
        setMessage(`재고와 매출을 반영하고 있습니다. 남은 대기 ${remaining.toLocaleString('ko-KR')}건`)
        const response = await fetch(`/api/outbound-reflection/${selectedBatchId}/apply?limit=300`, { method: 'POST' })
        const json = await readJson<ApplyResponse>(response)
        if (!response.ok) throw new Error(json.error ?? '출고반영에 실패했습니다.')
        totalApplied += Number(json.applied ?? 0)
        totalExcluded += Number(json.excluded ?? 0)
        remaining = Number(json.readyRows ?? 0)
        if (json.done) break
      }
      const summary = `출고반영 완료: 재고·매출 ${totalApplied.toLocaleString('ko-KR')}건${totalExcluded ? `, 중복 제외 ${totalExcluded.toLocaleString('ko-KR')}건` : ''}`
      setMessage(summary)
      toast.success(summary)
      router.refresh()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '출고반영에 실패했습니다.'
      setMessage(errorMessage)
      toast.error(errorMessage)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4" aria-busy={uploading || applying}>
      <form action={handleUpload} className="grid gap-3 lg:grid-cols-[1.45fr_1fr_1fr_auto] lg:items-end">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">사방넷 검수 엑셀</span>
          <input name="file" type="file" accept=".xlsx" required disabled={uploading || applying} className="h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-60" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">마켓 보정</span>
          <select name="marketplaceId" disabled={uploading || applying} className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60">
            <option value="">파일 기준 자동 매칭</option>
            {marketplaces.map((marketplace) => <option key={marketplace.id} value={marketplace.id}>{marketplace.label}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">업로드 양식</span>
          <select name="templateId" disabled={uploading || applying} className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-60">
            {templates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={uploading || applying} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {uploading ? '등록 중...' : '대기열 등록'}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">주문관리 단계는 만들지 않습니다. 반영 버튼을 눌러야 재고 이력과 매출분석에 기록됩니다.</p>
        <button type="button" onClick={handleApply} disabled={!selectedBatchId || readyRows <= 0 || uploading || applying} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
          {applying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {applying ? '반영 중...' : `반영 대기 ${readyRows.toLocaleString('ko-KR')}건 실행`}
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
