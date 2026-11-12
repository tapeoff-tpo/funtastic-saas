'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileImage, Loader2, Paperclip, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { PurchaseInspection } from '@/lib/purchasing/purchase-inspection'
import type { PurchaseInspectionIssue } from '@/lib/purchasing/purchase-inspection-issues'
import { PurchaseInspectionPurchaseEditor, type InspectionPurchaseFields } from './purchase-inspection-purchase-editor'

const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_BYTES = 700 * 1024

type IssueDetail = {
  id: string
  status: string
  productName: string
  inspection: PurchaseInspection
  purchaseFields: InspectionPurchaseFields
  inspectionIssues: PurchaseInspectionIssue[]
}

function attachmentUrl(purchaseItemId: string, issueId: string, attachmentId: string) {
  return `/api/purchasing/purchase-requests/${purchaseItemId}/inspection/issues/${issueId}/attachments/${attachmentId}`
}

function formatRegisteredAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

async function compressPhoto(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('사진 파일만 첨부할 수 있습니다.')
  if (!('createImageBitmap' in window)) {
    if (file.size <= MAX_ATTACHMENT_BYTES) return file
    throw new Error('이 브라우저에서는 큰 사진을 자동 압축할 수 없습니다. 700KB 이하 사진을 선택해주세요.')
  }
  const bitmap = await createImageBitmap(file)
  try {
    for (const [maxSide, quality] of [[1280, 0.78], [1024, 0.72], [840, 0.66], [720, 0.6]] as const) {
      const scale = Math.min(maxSide / bitmap.width, maxSide / bitmap.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('사진 압축을 시작하지 못했습니다.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error('사진 압축에 실패했습니다.')), 'image/jpeg', quality)
      })
      if (blob.size <= MAX_ATTACHMENT_BYTES) {
        const name = `${file.name.replace(/\.[^.]+$/, '') || 'inspection-photo'}.jpg`
        return new File([blob], name, { type: 'image/jpeg' })
      }
    }
  } finally {
    bitmap.close()
  }
  throw new Error('사진을 700KB 이하로 압축하지 못했습니다. 더 작은 사진을 선택해주세요.')
}

export function PurchaseInspectionIssueList({
  purchaseItemId,
  issues,
  emptyLabel = '등록된 검수 오류가 없습니다.',
}: {
  purchaseItemId: string
  issues: PurchaseInspectionIssue[]
  emptyLabel?: string
}) {
  if (issues.length === 0) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  return <div className="space-y-2">
    {issues.map((issue, issueIndex) => <section key={issue.id} className="rounded-lg border border-red-200 bg-red-50/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-red-900">검수 오류 {issueIndex + 1}</p>
          {issue.createdAt ? <p className="mt-0.5 text-xs text-red-800/75">{formatRegisteredAt(issue.createdAt)} 등록</p> : null}
        </div>
        <span className="shrink-0 text-xs text-red-800">사진 {issue.attachments.length}장</span>
      </div>
      <p data-no-translate className="mt-2 whitespace-pre-wrap text-sm text-red-950">{issue.description}</p>
      {issue.attachments.length > 0 ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {issue.attachments.map((attachment) => {
          const url = attachmentUrl(purchaseItemId, issue.id, attachment.id)
          return <a key={attachment.id} href={url} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-md border bg-background" title={attachment.fileName}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`검수 오류 사진: ${attachment.fileName}`} loading="lazy" className="aspect-square w-full object-cover transition group-hover:scale-[1.02]" />
            <span data-no-translate className="block truncate px-1.5 py-1 text-[11px] text-muted-foreground">{attachment.fileName}</span>
          </a>
        })}
      </div> : null}
    </section>)}
  </div>
}

export function PurchaseInspectionIssueRegister({
  purchaseItemId,
  disabled,
  onRegistered,
}: {
  purchaseItemId: string
  disabled?: boolean
  onRegistered: (saved: { inspection: PurchaseInspection; issue: PurchaseInspectionIssue }) => void
}) {
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [preparing, setPreparing] = useState(false)
  const [pending, setPending] = useState(false)

  async function selectPhotos(files: FileList | null) {
    if (!files) return
    const room = MAX_ATTACHMENTS - photos.length
    if (room <= 0) {
      toast.error(`사진은 최대 ${MAX_ATTACHMENTS}장까지 첨부할 수 있습니다.`)
      return
    }
    setPreparing(true)
    try {
      const selected = await Promise.all(Array.from(files).slice(0, room).map(compressPhoto))
      setPhotos((current) => [...current, ...selected].slice(0, MAX_ATTACHMENTS))
      if (files.length > room) toast.message(`사진은 최대 ${MAX_ATTACHMENTS}장까지만 추가했습니다.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '사진 준비에 실패했습니다.')
    } finally {
      setPreparing(false)
    }
  }

  async function register() {
    if (!description.trim()) {
      toast.error('오류 설명을 입력해주세요.')
      return
    }
    setPending(true)
    try {
      const formData = new FormData()
      formData.set('description', description.trim())
      photos.forEach((photo) => formData.append('photos', photo))
      const response = await fetch(`/api/purchasing/purchase-requests/${purchaseItemId}/inspection/issues`, {
        method: 'POST', body: formData,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? '검수 오류 등록에 실패했습니다.')
      onRegistered(body as { inspection: PurchaseInspection; issue: PurchaseInspectionIssue })
      setDescription('')
      setPhotos([])
      toast.success('검수 오류를 등록했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '검수 오류 등록에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  const busy = Boolean(disabled || preparing || pending)
  return <section className="space-y-3 rounded-lg border border-red-200 bg-red-50/40 p-3">
    <div>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-900"><AlertTriangle className="size-4" />검수 오류 등록</h3>
      <p className="mt-1 text-xs text-red-800/80">오류 설명만으로 등록할 수 있으며, 사진은 선택입니다.</p>
    </div>
    <label className="block text-sm font-medium">오류 설명
      <textarea
        value={description}
        maxLength={2_000}
        rows={3}
        disabled={busy}
        placeholder="예: 수량 10개 부족, 박스 2번 모서리 파손"
        className="mt-1 block w-full rounded border bg-background p-2 text-sm disabled:opacity-60"
        onChange={(event) => setDescription(event.target.value)}
      />
    </label>
    <div>
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-sm font-medium hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
        {preparing ? <Loader2 className="size-4 animate-spin" /> : <FileImage className="size-4" />}
        사진 첨부 (선택)
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only" disabled={busy || photos.length >= MAX_ATTACHMENTS} onChange={(event) => { void selectPhotos(event.target.files); event.currentTarget.value = '' }} />
      </label>
      <p className="mt-1 text-xs text-muted-foreground">자동 압축 후 장당 700KB 이하로 저장 · 최대 {MAX_ATTACHMENTS}장</p>
      {photos.length > 0 ? <ul className="mt-2 space-y-1">
        {photos.map((photo, index) => <li key={`${photo.name}-${index}`} className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1.5 text-xs">
          <span data-no-translate className="min-w-0 truncate"><Paperclip className="mr-1 inline size-3" />{photo.name} · {Math.ceil(photo.size / 1024)}KB</span>
          <button type="button" disabled={busy} onClick={() => setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`${photo.name} 제거`}><X className="size-3.5" /></button>
        </li>)}
      </ul> : null}
    </div>
    <div className="flex justify-end"><Button type="button" variant="outline" disabled={busy} onClick={() => void register()}>{pending ? <Loader2 className="animate-spin" /> : <AlertTriangle />}오류 등록</Button></div>
  </section>
}

export function PurchaseInspectionIssueButton({ purchaseItemId, issueCount }: { purchaseItemId: string; issueCount: number }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" size="sm" variant="outline" className="border-red-300 bg-red-50 text-red-800 hover:bg-red-100" onClick={() => setOpen(true)}>
      <AlertTriangle />오류 {issueCount}건
    </Button>
    {open ? <PurchaseInspectionIssueDialog purchaseItemId={purchaseItemId} onClose={() => setOpen(false)} /> : null}
  </>
}

function PurchaseInspectionIssueDialog({ purchaseItemId, onClose }: { purchaseItemId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [detail, setDetail] = useState<IssueDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { ref.current?.showModal() }, [])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/purchasing/purchase-requests/${purchaseItemId}/inspection`, { cache: 'no-store', signal: controller.signal })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? '검수 오류를 불러오지 못했습니다.')
        if (!controller.signal.aborted) setDetail(body as IssueDetail)
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '검수 오류를 불러오지 못했습니다.')
      }
    })()
    return () => controller.abort()
  }, [purchaseItemId])

  return <dialog ref={ref} aria-labelledby="purchase-inspection-issues-title" onClose={onClose}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[min(42rem,94vw)] overflow-y-auto rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40">
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background p-4">
      <div><h2 id="purchase-inspection-issues-title" className="flex items-center gap-1.5 text-lg font-semibold"><AlertTriangle className="size-5 text-red-700" />검수 오류</h2>{detail ? <p data-no-translate className="mt-1 text-sm text-muted-foreground">{detail.productName}</p> : null}</div>
      <Button type="button" variant="outline" onClick={() => ref.current?.close()}>닫기</Button>
    </div>
    <div className="p-4">
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : !detail ? <p className="text-sm text-muted-foreground">불러오는 중…</p> : <>
        <PurchaseInspectionIssueList purchaseItemId={purchaseItemId} issues={detail.inspectionIssues ?? []} />
        {detail.purchaseFields && detail.inspection ? <PurchaseInspectionPurchaseEditor
          purchaseItemId={purchaseItemId} status={detail.status} inspection={detail.inspection}
          issues={detail.inspectionIssues ?? []} purchaseFields={detail.purchaseFields}
          onCorrected={(saved) => setDetail((current) => current ? {
            ...current, inspection: saved.inspection,
            purchaseFields: { ...current.purchaseFields, actualPurchaseQuantity: saved.actualPurchaseQuantity },
          } : current)}
        /> : null}
      </>}
    </div>
  </dialog>
}
