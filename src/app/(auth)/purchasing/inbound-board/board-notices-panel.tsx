'use client'

import { useEffect, useState } from 'react'
import type { BoardNotice, NoticeCategory } from '@/lib/purchasing/board-notices'

export function BoardNoticesPanel({ category, compact, composing, onComposingChange, filter }: { category: NoticeCategory; compact?: boolean; composing?: boolean; onComposingChange?: (value: boolean) => void; filter?: string }) {
  const [posts, setPosts] = useState<BoardNotice[]>([])
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [localWriting, setLocalWriting] = useState(false)
  const writing = composing ?? localWriting
  const setWriting = onComposingChange ?? setLocalWriting
  const search = filter ?? query
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const url = '/api/purchasing/inbound-board?category=' + category

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void fetch(url + '&q=' + encodeURIComponent(search), { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        if (!controller.signal.aborted) setPosts(result.posts)
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [search, revision, url])

  return <section className="space-y-4">
    {!compact && <div className="flex flex-wrap gap-2">
      <form className="flex flex-1 gap-2" onSubmit={(event) => {
        event.preventDefault()
        setError('')
        setQuery(String(new FormData(event.currentTarget).get('q')).trim())
      }}>
        <input name="q" aria-label="게시글 검색" placeholder="제목·내용·파일명 검색" maxLength={200} className="w-full rounded-md border bg-background px-3 py-2 text-sm sm:max-w-sm" />
        <button className="rounded-md border bg-background px-4 text-sm">검색</button>
      </form>
      <button type="button" onClick={() => setWriting(!writing)} className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">{writing ? '글쓰기 닫기' : category === 'inbound-info' ? '입고정보 작성' : '글쓰기'}</button>
    </div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {writing && <form className="space-y-3 rounded-lg border bg-background p-4" onSubmit={async (event) => {
      event.preventDefault()
      if (busy) return
      const form = new FormData(event.currentTarget)
      form.set('category', category)
      setBusy(true)
      setError('')
      try {
        const response = await fetch('/api/purchasing/inbound-board', { method: 'POST', body: form })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        setWriting(false)
        setQuery('')
        setRevision((value) => value + 1)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '게시하지 못했습니다.')
      } finally {
        setBusy(false)
      }
    }}>
      <label className="block text-sm font-medium">제목<input name="title" required maxLength={200} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
      <label className="block text-sm font-medium">내용<textarea name="body" rows={6} maxLength={15000} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
      <label className="block text-sm font-medium">첨부파일<input name="attachment" type="file" accept=".xlsx,.xls,.csv,.pdf,.txt" className="mt-1 block text-sm" /></label>
      <p className="text-xs text-muted-foreground">엑셀, CSV, PDF, 텍스트 · 최대 2MB</p>
      <button disabled={busy} className="rounded-md bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? '게시 중…' : '게시하기'}</button>
    </form>}
    <div className={compact ? "divide-y" : "divide-y rounded-lg border bg-background"}>
      {loading ? <p role="status" className="p-4 text-sm">불러오는 중…</p> : posts.length === 0 ? compact ? null : <p className="p-4 text-sm text-muted-foreground">게시글이 없습니다.</p> : posts.map((post) => (
        <details key={post.id} className="p-4">
          <summary className="cursor-pointer text-sm font-medium">{post.title} <span className="ml-2 text-xs font-normal text-muted-foreground">{post.date}</span></summary>
          {post.body && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{post.body}</p>}
          {post.filename && <a className="mt-3 inline-block text-sm text-teal-700 underline" href={url + '&attachment=' + encodeURIComponent(post.id)} download>{post.filename}</a>}
        </details>
      ))}
    </div>
  </section>
}
