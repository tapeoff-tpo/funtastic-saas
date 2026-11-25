'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { BoardNoticesPanel } from './board-notices-panel'
import { useEffect, useState } from 'react'
import type { InboundPost, InboundPostSummary } from '@/lib/purchasing/inbound-board-store'
import { koreaShippingRows, formatKoreaBoxNumbers } from '@/lib/purchasing/korea-shipping-rows'

export function InboundBoardPanel({ postId, onSelect }: { postId: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [writingInfo, setWritingInfo] = useState(false)
  const [search, setSearch] = useState('')
  const [posts, setPosts] = useState<InboundPostSummary[]>([])
  const [post, setPost] = useState<InboundPost | null>(null)
  const [expected, setExpected] = useState('')
  const [received, setReceived] = useState('')
  const [freight, setFreight] = useState('')
  const [note, setNote] = useState('')
  const [memoName, setMemoName] = useState('')
  const [viewer, setViewer] = useState<{ id: string; isAdmin: boolean } | null>(null)
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
      setFreight(data.post.freightKrw == null ? '' : String(data.post.freightKrw))
      setNote(data.post.note ?? '')
      setMemoName(data.post.memoAuthor?.name ?? '')
      setViewer(data.viewer ?? null)
    }).catch((cause) => { if (!abort.signal.aborted) setError(cause.message) }).finally(() => { if (!abort.signal.aborted) setOpening(false) })
    return () => abort.abort()
  }, [postId])
  const canEditMemo = !post?.memoOwnerId || viewer?.isAdmin || post.memoOwnerId === viewer?.id
  const canDeleteMemo = Boolean(post?.memoOwnerId && canEditMemo)
  async function deleteMemo() {
    if (!post || !canDeleteMemo || saving || !window.confirm('화물차 비용과 특이사항을 삭제할까요?')) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/purchasing/inbound-board', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id, revision: post.revision }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setPost((current) => current?.id === post.id ? { ...current, ...data.post } : current)
      setRefresh((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '메모를 삭제하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => {
    setFreight(post?.freightKrw == null ? '' : String(post.freightKrw))
    setNote(post?.note ?? '')
    setMemoName(post?.memoAuthor?.name ?? '')
  }, [post])

  async function saveDates() {
    if (!post || saving) return
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/purchasing/inbound-board', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: post.id, revision: post.revision, expectedDate: expected, receivedDate: received || null, ...(canEditMemo && (freight !== (post.freightKrw == null ? '' : String(post.freightKrw)) || note !== post.note || memoName !== (post.memoAuthor?.name ?? '')) ? { freightKrw: freight === '' ? null : Number(freight), note, memoName } : {}) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setPost((current) => current?.id === post.id ? { ...current, ...data.post } : current); setRefresh((value) => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.') } finally { setSaving(false) }
  }
  const rows = post ? koreaShippingRows(post.detail, 'box') : []
  const url = post ? `/api/purchasing/inbound-board?id=${post.id}` : ''
  return <section className="space-y-4">
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); setRefresh((value) => value + 1) }}>
      <input aria-label="입고리스트 상품 검색" placeholder="상품명·옵션·품목코드·로케이션 검색" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} className="h-10 min-w-64 flex-1 rounded border px-3" />
      <button className="rounded bg-primary px-4 text-primary-foreground">검색</button>
    </form>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="grid min-w-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="max-h-[75vh] overflow-auto rounded border bg-background">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <span>{loading ? '검색 중…' : `${posts.length}건 · 최근 입고 예정일 순 (최대 100건)`}</span>
          <button type="button" aria-label="입고정보 작성" aria-expanded={writingInfo} title="입고정보 작성"
            onClick={() => setWritingInfo(!writingInfo)}
            className="size-7 shrink-0 rounded-md border border-teal-200 bg-teal-50 text-base font-medium text-teal-800 hover:bg-teal-100">+</button>
        </div>
        <BoardNoticesPanel compact category="inbound-info" composing={writingInfo} onComposingChange={setWritingInfo} filter={search} />
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
          <form className="my-4 space-y-3 rounded border bg-muted/40 p-4 text-sm" onSubmit={(event) => { event.preventDefault(); void saveDates() }}>
            <h3 className="font-semibold">입고 메모</h3>
            {post.memoAuthor && <p className="text-xs text-muted-foreground">
              작성 계정 {post.memoAuthor.account ?? '확인 불가'} · 이름 {post.memoAuthor.name || '미입력'} · 작성일 {post.memoAuthor.date}
            </p>}
            <div className="flex flex-wrap gap-3">
              <label>작성자 이름<input disabled={!canEditMemo} value={memoName} maxLength={100} placeholder="기본값은 계정 이름" onChange={(event) => setMemoName(event.target.value)} className="ml-2 rounded border bg-background p-1" /></label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
            <label>입고 예정일<input type="date" value={expected} onChange={(event) => setExpected(event.target.value)} className="ml-2 rounded border p-1" /></label>
            <label>실제 입고일<input type="date" value={received} onChange={(event) => setReceived(event.target.value)} className="ml-2 rounded border p-1" /></label>
            </div>
            <label className="block">화물차 비용 (원)
              <input disabled={!canEditMemo} type="number" min={0} max={2147483647} step={1} value={freight} onChange={(event) => setFreight(event.target.value)} className="mt-1 block rounded border bg-background px-2 py-1" />
              <span className="mt-1 block text-xs text-muted-foreground">원가 작성용</span>
            </label>
            <label className="block">특이사항
              <textarea disabled={!canEditMemo} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={3000} className="mt-1 block w-full rounded border bg-background p-2" />
            </label>
            <button type="submit" disabled={saving || !expected} className="rounded border bg-background px-3 py-1">{saving ? '저장 중…' : '입고 메모 저장'}</button>
            {canDeleteMemo && <button type="button" disabled={saving} onClick={deleteMemo} className="ml-2 rounded border border-red-200 px-3 py-1 text-red-700">메모 삭제</button>}
          </form>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
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

export function InboundBoardWorkspace({ initialCategories = [] }: { initialCategories?: Array<{ id: `custom-${string}`; name: string }> }) {
  const router = useRouter()
  const params = useSearchParams()
  const category = params.get('category')
  const postId = params.get('post') ?? ''
  const [custom, setCustom] = useState<Array<{ id: `custom-${string}`; name: string }>>(initialCategories)
  const [adding, setAdding] = useState(false)
  const [savingCategory, setSavingCategory] = useState(false)
  const [categoryError, setCategoryError] = useState('')
  const customCategory = custom.find(({ id }) => id === category)
  const active = customCategory?.id ?? (category === 'sold-out' || category === 'all' || category === 'inbound-list'
    ? category
    : postId || category === 'inbound-info' ? 'inbound-list' : 'all')
  const groups = [
    { id: 'all', name: '전체' },
    { id: 'inbound-list', name: '입고리스트' },
    { id: 'sold-out', name: '품절리스트' },
    ...custom,
  ]
  return <>
    <nav aria-label="게시판 분류" className="flex flex-wrap items-center gap-2 border-b">
      {groups.map(({ id, name }) => <Link key={id} href={'/purchasing/inbound-board?category=' + id}
        aria-current={active === id ? 'page' : undefined}
        className={active === id ? 'border-b-2 border-teal-700 px-4 py-2 text-sm font-medium text-teal-800' : 'px-4 py-2 text-sm text-muted-foreground hover:text-foreground'}>{name}</Link>)}
      <button type="button" aria-label="게시판 분류 추가" aria-expanded={adding} title="게시판 분류 추가" onClick={() => setAdding(!adding)}
        className="ml-auto size-8 rounded-md border bg-background text-lg text-teal-800 hover:bg-teal-50">+</button>
    </nav>
    {categoryError && <p role="alert" className="text-sm text-red-700">{categoryError}</p>}
    {adding && <form className="flex flex-wrap items-end gap-2 rounded-md border bg-background p-3" onSubmit={async (event) => {
      event.preventDefault()
      if (savingCategory) return
      const name = new FormData(event.currentTarget).get('name')
      setSavingCategory(true)
      setCategoryError('')
      try {
        const response = await fetch('/api/purchasing/inbound-board', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create-category', name }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        setCustom((current) => current.some(({ id }) => id === result.category.id) ? current : [...current, result.category])
        setAdding(false)
        router.push('/purchasing/inbound-board?category=' + encodeURIComponent(result.category.id))
      } catch (error) {
        setCategoryError(error instanceof Error ? error.message : '분류를 추가하지 못했습니다.')
      } finally {
        setSavingCategory(false)
      }
    }}>
      <label className="text-sm">분류 이름<input name="name" required maxLength={30} className="ml-2 rounded border px-2 py-1" /></label>
      <button disabled={savingCategory} className="rounded bg-teal-700 px-3 py-1 text-sm text-white">추가</button>
    </form>}
    {(active === 'all' || active === 'inbound-list') && <section aria-labelledby="inbound-list-heading" className="space-y-3">
      <h2 id="inbound-list-heading" className="text-base font-semibold">입고리스트</h2>
      <InboundBoardPanel postId={postId} onSelect={(id) => {
        router.replace('/purchasing/inbound-board?category=' + active + '&post=' + encodeURIComponent(id), { scroll: false })
      }} />
    </section>}
    {(active === 'all' || active === 'sold-out') && <section aria-labelledby="sold-out-heading" className="space-y-3">
      <h2 id="sold-out-heading" className="text-base font-semibold">품절리스트</h2>
      <BoardNoticesPanel category="sold-out" />
    </section>}
    {(active === 'all' ? custom : customCategory ? [customCategory] : []).map(({ id, name }) => (
      <section key={id} aria-label={name} className="space-y-3">
        <h2 className="text-base font-semibold">{name}</h2>
        <BoardNoticesPanel category={id} />
      </section>
    ))}
  </>
}
