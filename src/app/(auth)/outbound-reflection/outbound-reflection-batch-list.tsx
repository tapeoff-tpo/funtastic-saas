'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { OutboundReflectionStatus } from '@/lib/outbound-reflection'

type BatchItem = {
  id: string
  sourceFileName: string
  applyInventory: boolean
  totalRows: number
  readyRows: number
  blockedRows: number
  appliedRows: number
  excludedRows: number
  createdAt: string
}

type DeleteResponse = {
  deleted?: boolean
  error?: string
}

export function OutboundReflectionBatchList({
  batches,
  selectedBatchId,
  selectedStatus,
}: {
  batches: BatchItem[]
  selectedBatchId?: string
  selectedStatus: OutboundReflectionStatus | 'all'
}) {
  const router = useRouter()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const pendingBatches = useMemo(() => batches.filter((batch) => batch.appliedRows === 0), [batches])
  const selectedCount = selectedIds.size
  const allPendingSelected = pendingBatches.length > 0 && pendingBatches.every((batch) => selectedIds.has(batch.id))

  function toggleBatch(batchId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(batchId)
      else next.delete(batchId)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(pendingBatches.map((batch) => batch.id)) : new Set())
  }

  async function deleteSelected() {
    const batchIds = [...selectedIds]
    if (batchIds.length === 0 || deleting) return
    if (!window.confirm(`선택한 출고반영 대기열 ${batchIds.length}개를 삭제할까요? 아직 반영하지 않은 파일만 삭제됩니다.`)) return

    setDeleting(true)
    const failed: string[] = []
    try {
      for (const batchId of batchIds) {
        const response = await fetch(`/api/outbound-reflection/${batchId}`, { method: 'DELETE' })
        const json = await readJson(response)
        if (!response.ok || !json.deleted) failed.push(json.error ?? '대기열 삭제에 실패했습니다.')
      }

      if (failed.length > 0) {
        toast.error(`${batchIds.length - failed.length}개 삭제, ${failed.length}개는 삭제하지 못했습니다.`)
      } else {
        toast.success(`출고반영 대기열 ${batchIds.length}개를 삭제했습니다.`)
      }
      setSelectedIds(new Set())
      router.push('/outbound-reflection')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '대기열 삭제에 실패했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">반영 이력</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">반영 전 파일을 선택해 삭제할 수 있습니다.</p>
        </div>
        <button
          type="button"
          onClick={deleteSelected}
          disabled={selectedCount === 0 || deleting}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-background px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          선택 삭제{selectedCount > 0 ? ` ${selectedCount}` : ''}
        </button>
      </div>

      {pendingBatches.length > 1 ? (
        <label className="flex cursor-pointer items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={allPendingSelected}
            onChange={(event) => toggleAll(event.target.checked)}
            disabled={deleting}
            className="size-4 rounded border-input accent-primary"
          />
          반영 전 파일 전체 선택
        </label>
      ) : null}

      <div className="divide-y">
        {batches.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">등록한 출고반영 파일이 없습니다.</div>
        ) : batches.map((batch) => {
          const deletable = batch.appliedRows === 0
          return (
            <div key={batch.id} className={`flex gap-2 px-4 py-3 ${selectedBatchId === batch.id ? 'bg-muted/70' : ''}`}>
              <div className="pt-0.5">
                <input
                  type="checkbox"
                  aria-label={`${batch.sourceFileName} 선택`}
                  checked={selectedIds.has(batch.id)}
                  onChange={(event) => toggleBatch(batch.id, event.target.checked)}
                  disabled={!deletable || deleting}
                  title={deletable ? '대기열 선택' : '반영된 파일은 대기열 삭제 대상이 아닙니다.'}
                  className="size-4 rounded border-input accent-primary disabled:cursor-not-allowed"
                />
              </div>
              <Link href={reflectionHref(batch.id, selectedStatus)} className="min-w-0 flex-1 text-sm hover:text-primary">
                <div className="truncate font-medium" title={batch.sourceFileName}>{batch.sourceFileName}</div>
                <div className="mt-1 text-xs text-muted-foreground">{formatKst(batch.createdAt)}</div>
                <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                  <Badge>전체 {batch.totalRows}</Badge>
                  <Badge tone="ready">대기 {batch.readyRows}</Badge>
                  <Badge tone="blocked">확인 {batch.blockedRows}</Badge>
                  <Badge tone="applied">완료 {batch.appliedRows}</Badge>
                  <Badge>{batch.applyInventory ? '재고 반영' : '재고 유지'}</Badge>
                  {batch.excludedRows ? <Badge>제외 {batch.excludedRows}</Badge> : null}
                </div>
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function reflectionHref(batchId: string, status: OutboundReflectionStatus | 'all') {
  const params = new URLSearchParams({ batch: batchId })
  if (status !== 'all') params.set('status', status)
  return `/outbound-reflection?${params.toString()}`
}

function formatKst(value: string) {
  return new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'ready' | 'blocked' | 'applied' }) {
  const className = tone === 'ready'
    ? 'border-blue-200 bg-blue-50 text-blue-700'
    : tone === 'blocked'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : tone === 'applied'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-border bg-background text-muted-foreground'
  return <span className={`rounded-full border px-1.5 py-0.5 ${className}`}>{children}</span>
}

async function readJson(response: Response): Promise<DeleteResponse> {
  try {
    return await response.json() as DeleteResponse
  } catch {
    return { error: '서버 응답을 읽지 못했습니다.' }
  }
}
