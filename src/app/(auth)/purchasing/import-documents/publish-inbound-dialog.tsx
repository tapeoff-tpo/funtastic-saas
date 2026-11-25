'use client'
import { useState } from 'react'
export function PublishInboundDialog({ shipmentId, onPublished, onClose }: { shipmentId: string; onPublished: (id: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [receivedDate, setReceivedDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><form role="dialog" aria-modal="true" aria-label="입고리스트 게시" className="w-full max-w-lg space-y-4 rounded-xl bg-background p-6 shadow-lg" onSubmit={async (event) => {
    event.preventDefault()
    if (pending) return
    setPending(true); setError('')
    try {
      const response = await fetch('/api/purchasing/inbound-board', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shipmentId, title: title.trim() || `${expectedDate} 입고리스트`, expectedDate, receivedDate: receivedDate || null, note }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      onPublished(data.post.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '게시하지 못했습니다.'); setPending(false) }
  }}>
    <h2 className="text-lg font-semibold">입고리스트 게시</h2>
    <label className="block text-sm">제목<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="미입력 시 입고 예정일로 자동 생성" className="mt-1 block w-full rounded border p-2" /></label>
    <div className="grid grid-cols-2 gap-3 text-sm"><label>입고 예정일<input required type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label>실제 입고일 (선택)<input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label></div>
    <label className="block text-sm">메모<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={3000} rows={3} className="mt-1 block w-full rounded border p-2" /></label>
    <p className="text-xs text-muted-foreground">현재 출고 상품·옵션·수량·로케이션을 저장합니다. 동일 출고 건의 게시글이 있으면 기존 글을 엽니다.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" disabled={pending} onClick={onClose} className="rounded border px-4 py-2">취소</button><button disabled={pending} className="rounded bg-primary px-4 py-2 text-primary-foreground">{pending ? '게시 중…' : '게시하기'}</button></div>
  </form></div>
}
