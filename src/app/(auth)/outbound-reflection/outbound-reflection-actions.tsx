'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'

type Option = { id: string; label: string }

type ImportResponse = {
  batchId?: string | null
  skipped?: boolean
  totalRows?: number
  readyRows?: number
  blockedRows?: number
  applyInventory?: boolean
  error?: string
}

type ApplyResponse = {
  applied?: number
  excluded?: number
  readyRows?: number
  done?: boolean
  applyInventory?: boolean
  error?: string
}

type DeleteResponse = {
  deleted?: boolean
  error?: string
}

export function OutboundReflectionActions({
  marketplaces,
  templates,
  selectedBatchId,
  readyRows,
  appliedRows,
  applyInventory,
}: {
  marketplaces: Option[]
  templates: Option[]
  selectedBatchId?: string
  readyRows: number
  appliedRows: number
  applyInventory: boolean
}) {
  const router = useRouter()
  const uploadInFlightRef = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function handleUpload(formData: FormData) {
    if (uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    setUploading(true)
    setMessage('사방넷 검수 파일을 출고반영 대기열로 읽고 있습니다.')
    try {
      const file = formData.get('file')
      if (!(file instanceof File) || file.size === 0) throw new Error('업로드할 엑셀 파일을 선택해주세요.')
      const willApplyInventory = formData.get('applyInventory') === 'true'
      if (!willApplyInventory && !window.confirm('이 파일은 재고 수량이 이미 반영된 상태입니다. 출고·매출만 기록하고 재고 수량과 재고 이력은 변경하지 않습니다. 계속할까요?')) return
      const response = await fetch('/api/outbound-reflection/import', { method: 'POST', body: formData })
      const json = await readJson<ImportResponse>(response)
      if (!response.ok) throw new Error(json.error ?? '출고반영 파일 업로드에 실패했습니다.')
      const summary = json.skipped
        ? '같은 파일이 이미 등록되어 기존 대기열을 열었습니다.'
        : `대기열 등록: ${json.applyInventory === false ? '재고 변동 없음, 매출·출고만 기록' : '재고·매출 반영'} · 전체 ${(json.totalRows ?? 0).toLocaleString('ko-KR')}건, 반영 대기 ${(json.readyRows ?? 0).toLocaleString('ko-KR')}건, 확인 필요 ${(json.blockedRows ?? 0).toLocaleString('ko-KR')}건`
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
        setMessage(`${applyInventory ? '재고와 매출' : '매출과 출고 이력만'} 반영하고 있습니다. 남은 대기 ${remaining.toLocaleString('ko-KR')}건`)
        const response = await fetch(`/api/outbound-reflection/${selectedBatchId}/apply?limit=300`, { method: 'POST' })
        const json = await readJson<ApplyResponse>(response)
        if (!response.ok) throw new Error(json.error ?? '출고반영에 실패했습니다.')
        totalApplied += Number(json.applied ?? 0)
        totalExcluded += Number(json.excluded ?? 0)
        remaining = Number(json.readyRows ?? 0)
        if (json.done) break
      }
      const summary = `출고반영 완료: ${applyInventory ? '재고·매출' : '매출·출고 이력만'} ${totalApplied.toLocaleString('ko-KR')}건${totalExcluded ? `, 중복 제외 ${totalExcluded.toLocaleString('ko-KR')}건` : ''}`
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

  async function handleDelete() {
    if (!selectedBatchId || appliedRows > 0 || deleting) return
    if (!window.confirm('이 출고반영 대기열을 삭제하시겠습니까? 아직 반영 전이라 재고와 매출에는 영향이 없습니다.')) return

    setDeleting(true)
    try {
      const response = await fetch(`/api/outbound-reflection/${selectedBatchId}`, { method: 'DELETE' })
      const json = await readJson<DeleteResponse>(response)
      if (!response.ok) throw new Error(json.error ?? '출고반영 파일 삭제에 실패했습니다.')
      toast.success('출고반영 대기열을 삭제했습니다.')
      router.push('/outbound-reflection')
      router.refresh()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '출고반영 파일 삭제에 실패했습니다.'
      setMessage(errorMessage)
      toast.error(errorMessage)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4" aria-busy={uploading || applying || deleting}>
      <form action={handleUpload} className="grid gap-3 lg:grid-cols-[1.45fr_1fr_1fr_1.2fr_auto] lg:items-end">
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
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">재고 반영</span>
          <span className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm">
            <input name="applyInventory" value="true" type="checkbox" defaultChecked disabled={uploading || applying} className="size-4 rounded border-input accent-primary" />
            재고 수량도 반영
          </span>
        </label>
        <button type="submit" disabled={uploading || applying} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {uploading ? '등록 중...' : '대기열 등록'}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-xs text-muted-foreground">주문관리 단계는 만들지 않습니다. 재고 수량도 반영을 끄면 매출·출고 이력만 기록하고 재고는 변경하지 않습니다.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleDelete} disabled={!selectedBatchId || appliedRows > 0 || uploading || applying || deleting} title={appliedRows > 0 ? '이미 반영한 파일은 삭제할 수 없습니다.' : undefined} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-red-200 bg-background px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
            {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {deleting ? '삭제 중...' : '대기열 삭제'}
          </button>
          <button type="button" onClick={handleApply} disabled={!selectedBatchId || readyRows <= 0 || uploading || applying || deleting} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
            {applying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {applying ? '반영 중...' : `반영 대기 ${readyRows.toLocaleString('ko-KR')}건 실행`}
          </button>
        </div>
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
