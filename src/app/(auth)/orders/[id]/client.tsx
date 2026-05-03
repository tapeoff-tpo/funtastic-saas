'use client'

import { useRef, useState, useTransition } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ImagePlus, X } from 'lucide-react'

const CLAIM_STATUS_FLOW: Record<string, string[]> = {
  requested: ['processing', 'rejected'],
  processing: ['completed', 'rejected'],
  completed: [],
  rejected: [],
}

interface ClaimListProps {
  claims: Array<{
    id: string
    claimType: string
    claimStatus: string
    reason: string | null
    requestedAt: string
  }>
  typeLabels: Record<string, string>
  statusLabels: Record<string, string>
}

function ClaimList({ claims, typeLabels, statusLabels }: ClaimListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)

  function changeStatus(claimId: string, nextStatus: string) {
    setPendingId(claimId)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/claims/${claimId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimStatus: nextStatus }),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? 'Failed')
        }
        toast.success(`상태 변경됨: ${statusLabels[nextStatus]}`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '상태 변경 실패')
      } finally {
        setPendingId(null)
      }
    })
  }

  return (
    <ul className="space-y-3">
      {claims.map((c) => (
        <li key={c.id} className="rounded-md border p-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="rounded border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                {typeLabels[c.claimType] ?? c.claimType}
              </span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">
                {statusLabels[c.claimStatus] ?? c.claimStatus}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {format(new Date(c.requestedAt), 'yyyy-MM-dd HH:mm')}
            </span>
          </div>
          {c.reason && <p className="text-muted-foreground">{c.reason}</p>}
          {CLAIM_STATUS_FLOW[c.claimStatus]?.length > 0 && (
            <div className="mt-3 flex gap-2">
              {CLAIM_STATUS_FLOW[c.claimStatus].map((next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => changeStatus(c.id, next)}
                  disabled={isPending && pendingId === c.id}
                  className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                    next === 'rejected'
                      ? 'border-red-300 text-red-700 hover:bg-red-50'
                      : 'border-primary/40 text-primary hover:bg-primary/10'
                  }`}
                >
                  {statusLabels[next] ?? next}
                </button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

interface MemoPanelProps {
  orderId: string
  initialMemos: Array<{
    id: string
    content: string
    memoType: string
    attachments?: MemoAttachment[]
    createdAt: string
  }>
}

interface MemoAttachment {
  name: string
  type: string
  dataUrl: string
  size: number
}

const MAX_MEMO_ATTACHMENTS = 5
const MAX_MEMO_ATTACHMENT_BYTES = 3 * 1024 * 1024

function readImageFile(file: File): Promise<MemoAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) reject(new Error('이미지를 읽을 수 없습니다'))
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl,
      })
    }
    reader.onerror = () => reject(new Error('이미지를 읽을 수 없습니다'))
    reader.readAsDataURL(file)
  })
}

function MemoPanel({ orderId, initialMemos }: MemoPanelProps) {
  const [memos, setMemos] = useState(initialMemos)
  const [content, setContent] = useState('')
  const [memoType, setMemoType] = useState('general')
  const [attachments, setAttachments] = useState<MemoAttachment[]>([])
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const slots = MAX_MEMO_ATTACHMENTS - attachments.length
    if (slots <= 0) {
      toast.error(`사진은 최대 ${MAX_MEMO_ATTACHMENTS}장까지 첨부할 수 있습니다`)
      return
    }
    const selected = Array.from(files).slice(0, slots)
    const invalid = selected.find((file) => !file.type.startsWith('image/') || file.size > MAX_MEMO_ATTACHMENT_BYTES)
    if (invalid) {
      toast.error('사진 파일만 첨부할 수 있고, 파일당 3MB 이하여야 합니다')
      return
    }
    try {
      const next = await Promise.all(selected.map(readImageFile))
      setAttachments((prev) => [...prev, ...next])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '사진 첨부 실패')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function submit() {
    const trimmed = content.trim()
    if (!trimmed && attachments.length === 0) {
      toast.error('메모 내용 또는 사진을 추가하세요')
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/memos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed, memoType, attachments }),
        })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(error ?? 'Failed')
        }
        const { memo } = await res.json()
        setMemos([{ ...memo, createdAt: memo.createdAt }, ...memos])
        setContent('')
        setAttachments([])
        toast.success('메모 추가됨')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '메모 추가 실패')
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Add form */}
      <div className="space-y-2">
        <select
          value={memoType}
          onChange={(e) => setMemoType(e.target.value)}
          className="w-full rounded-md border px-2 py-1 text-sm"
        >
          <option value="general">일반</option>
          <option value="cs">CS 문의</option>
          <option value="cancel">취소</option>
          <option value="return">반품</option>
          <option value="exchange">교환</option>
        </select>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="메모 내용..."
          rows={3}
          className="w-full rounded-md border px-2 py-1 text-sm"
        />
        {attachments.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {attachments.map((attachment, index) => (
              <div key={`${attachment.name}-${index}`} className="relative overflow-hidden rounded-md border bg-muted">
                <Image
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  width={160}
                  height={80}
                  unoptimized
                  className="h-20 w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                  className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                  aria-label="첨부 제거"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending || attachments.length >= MAX_MEMO_ATTACHMENTS}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <ImagePlus className="h-4 w-4" />
            사진 첨부
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || (!content.trim() && attachments.length === 0)}
            className="flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? '추가 중...' : '메모 추가'}
          </button>
        </div>
      </div>

      {/* List */}
      <div className="max-h-96 space-y-2 overflow-y-auto border-t pt-3">
        {memos.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            메모가 없습니다
          </p>
        ) : (
          memos.map((m) => (
            <div key={m.id} className="rounded-md border bg-muted/30 p-2 text-sm">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="rounded bg-white px-1.5 py-0.5 font-medium">
                  {m.memoType}
                </span>
                <span>{format(new Date(m.createdAt), 'MM-dd HH:mm')}</span>
              </div>
              {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
              {(m.attachments?.length ?? 0) > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {m.attachments?.map((attachment, index) => (
                    <a
                      key={`${m.id}-${index}`}
                      href={attachment.dataUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded border bg-white"
                      title={attachment.name}
                    >
                      <Image
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        width={160}
                        height={80}
                        unoptimized
                        className="h-20 w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export { ClaimList, MemoPanel }
