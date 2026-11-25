'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { InboundPost, InboundPostSummary } from '@/lib/purchasing/inbound-board-store'
import { koreaShippingRows, formatKoreaBoxNumbers } from '@/lib/purchasing/korea-shipping-rows'

export function InboundBoardPanel({ postId, onSelect }: { postId: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [posts, setPosts] = useState<InboundPostSummary[]>([])
  const [post, setPost] = useState<InboundPost | null>(null)
  const [group, setGroup] = useState<'pallet' | 'box'>('pallet')
  const [expected, setExpected] = useState('')
  const [received, setReceived] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true); setError('')
    void fetch(`/api/purchasing/inbound-board?q=${encodeURIComponent(search)}`, { signal: abort.signal, cache: 'no-store' }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setPosts(data.posts)
    }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message) }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [search, refresh])
  useEffect(() => {
    setPost(null)
    if (!postId) return
    const abort = new AbortController()
    setOpening(true); setError('')
    void fetch(`/api/purchasing/inbound-board?id=${encodeURIComponent(postId)}`, { signal: abort.signal, cache: 'no-store' }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setPost(data.post); setExpected(data.post.expectedDate); setReceived(data.post.receivedDate ?? '')
    }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message) }).finally(() => { if (!abort.signal.aborted) setOpening(false) })
    return () => abort.abort()
  }, [postId])
  async function saveDates() {
    if (!post || saving) return
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/purchasing/inbound-board', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: post.id, revision: post.revision, expectedDate: expected, receivedDate: received || null }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setPost({ ...post, ...data.post }); setRefresh((value) => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.') } finally { setSaving(false) }
  }
  const rows = post ? koreaShippingRows(post.detail, group) : []
  const url = post ? `/api/purchasing/inbound-board?id=${post.id}&group=${group}` : ''
  return <section className="space-y-4">
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); setRefresh((value) => value + 1) }}>
      <input aria-label="입고리스트 상품 검색" placeholder="상품명·옵션·품목코드·로케이션 검색" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} className="h-10 min-w-64 flex-1 rounded border px-3" />
      <button className="rounded bg-primary px-4 text-primary-foreground">검색</button>
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="max-h-[75vh] overflow-auto rounded border bg-background">
        <p className="border-b p-3 text-sm text-muted-foreground">{loading ? '검색 중…' : `${posts.length}건 · 최근 입고 예정일 순 (최대 100건)`}</p>
        {!loading && !posts.length && <p className="p-5 text-sm text-muted-foreground">{search ? '검색된 입고리스트가 없습니다.' : '한국 출고서류에서 입고리스트를 게시해주세요.'}</p>}
        {posts.map((entry) => <button key={entry.id} type="button" onClick={() => onSelect(entry.id)} className={`block w-full border-b p-3 text-left ${entry.id === postId ? 'bg-blue-50' : 'hover:bg-muted'}`}>
          <span className="block font-medium">{entry.title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">예정 {entry.expectedDate} · {entry.receivedDate ? `실입고 ${entry.receivedDate}` : '입고 확인 전'}</span>
          <span className="block text-xs text-muted-foreground">수량 {entry.quantity.toLocaleString()}개</span>
        </button>)}
      </div>
      <div className="min-w-0 rounded border bg-background p-4">
        {opening ? <p role="status">입고리스트 여는 중…</p> : !post ? <p className="p-8 text-center text-muted-foreground">입고리스트를 선택해주세요.</p> : <>
          <h2 className="text-xl font-semibold">{post.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">출고번호 {post.detail.shipment.shipmentNo} · 게시 당시 상품정보</p>
          {post.note && <p className="my-3 whitespace-pre-wrap text-sm">{post.note}</p>}
          <div className="my-4 flex flex-wrap items-end gap-3 rounded bg-muted/40 p-3 text-sm">
            <label>입고 예정일<input type="date" value={expected} onChange={(event) => setExpected(event.target.value)} className="ml-2 rounded border p-1" /></label>
            <label>실제 입고일<input type="date" value={received} onChange={(event) => setReceived(event.target.value)} className="ml-2 rounded border p-1" /></label>
            <button type="button" disabled={saving || !expected} onClick={saveDates} className="rounded border bg-background px-3 py-1">{saving ? '저장 중…' : '입고 날짜 저장'}</button>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            {(['pallet','box'] as const).map((value) => <label key={value} className="flex gap-1"><input type="radio" name="board-group" checked={group === value} onChange={() => setGroup(value)} />{value === 'pallet' ? '파레트 기준' : '박스 기준'}</label>)}
            <a className="rounded border px-3 py-2" href={`${url}&format=print`} target="_blank" rel="noreferrer">인쇄용 보기</a>
            <a className="rounded border px-3 py-2" href={`${url}&format=excel`}>엑셀 다운로드</a>
          </div>
          <div className="max-h-[65vh] overflow-auto rounded border"><table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 bg-slate-100"><tr>{['파레트','박스번호','품목코드','상품명','옵션','수량','창고','쿠팡','대량','로케이션'].map((label) => <th key={label} className="border-b px-3 py-2 text-left">{label}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr key={index} className="border-b"><td className="px-3 py-2">{row.pallet}</td><td className="px-3">{formatKoreaBoxNumbers(row.boxes)}</td><td className="px-3">{row.sku}</td><td className="px-3">{row.name}</td><td className="px-3">{row.option}</td><td className="px-3 text-right">{row.quantity.toLocaleString()}</td><td className="px-3 text-right">{row.warehouse || ''}</td><td className="px-3 text-right">{row.coupang || ''}</td><td className="px-3 text-right">{row.bulk || ''}</td><td className="px-3">{row.location}</td></tr>)}</tbody>
            <tfoot className="bg-slate-50 font-semibold"><tr><td colSpan={5} className="px-3 py-2">합계</td><td className="px-3 text-right">{rows.reduce((sum,row) => sum + row.quantity,0).toLocaleString()}</td><td colSpan={4} /></tr></tfoot>
          </table></div>
        </>}
      </div>
    </div>
  </section>
}

export function InboundBoardWorkspace() {
  const router = useRouter()
  const params = useSearchParams()
  return <InboundBoardPanel postId={params.get('post') ?? ''} onSelect={(id) => {
    router.replace('/purchasing/inbound-board?post=' + encodeURIComponent(id), { scroll: false })
  }} />
}
