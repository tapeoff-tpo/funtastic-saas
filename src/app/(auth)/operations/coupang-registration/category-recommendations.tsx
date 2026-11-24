'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Search } from 'lucide-react'
import type { CategoryContext } from '@/lib/coupang-registration/category-context'
import type { RegistrationDraft } from '@/lib/coupang-registration/model'
import { getSupplierCategoryTemplate, pingSupplierExtension, searchSupplierCategories, type SupplierCategory } from '@/lib/coupang-registration/supplier-bridge'

const API = '/api/operations/coupang-registration'
const button = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-40'
type ConnectedTemplate = RegistrationDraft['templates'][number]
type Props = { sourceCode: string; onConnect: (template: ConnectedTemplate, categoryId: string) => void }

export function CategoryRecommendations(props: Props) {
  return <CategoryRecommendationPanel key={props.sourceCode} {...props} />
}

function CategoryRecommendationPanel({ sourceCode, onConnect }: Props) {
  const [context, setContext] = useState<CategoryContext>()
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState<SupplierCategory[]>([])
  const [busy, setBusy] = useState(sourceCode ? '펀타스틱 상품 분류 확인 중' : '')
  const [error, setError] = useState('')
  const [needsExtension, setNeedsExtension] = useState(false)
  const [searched, setSearched] = useState(false)
  const generation = useRef(0)

  async function search(value: CategoryContext, override = '') {
    const session = ++generation.current
    setBusy('펀타 카테고리로 쿠팡 검색 중'); setError(''); setCategories([]); setSearched(false)
    try {
      const extension = await pingSupplierExtension()
      if (session !== generation.current) return
      if (!extension.supportsCategories) {
        setNeedsExtension(true)
        throw new Error('쿠팡 등록 확장을 업데이트하면 펀타 분류로 허브를 검색하고 공식 양식을 연결할 수 있습니다.')
      }
      setNeedsExtension(false)
      // Always start from the source category. A user correction and source tags
      // broaden the official search without inventing a marketplace mapping.
      const queries = [...new Set([value.categoryName, override, ...value.queries].filter(Boolean))].slice(0, 6)
      const result = await searchSupplierCategories(queries)
      if (session === generation.current) { setCategories(result); setSearched(true) }
    } catch (cause) {
      if (session === generation.current) setError(cause instanceof Error ? cause.message : '쿠팡 분류를 검색하지 못했습니다.')
    } finally { if (session === generation.current) setBusy('') }
  }

  useEffect(() => {
    let cancelled = false
    if (!sourceCode) return
    const invalidate = () => { generation.current++ }
    void fetch(`${API}/category-context?${new URLSearchParams({ code: sourceCode })}`).then(async (response) => {
      const body = await response.json()
      if (!response.ok || !body.context) throw new Error(body.error || '펀타스틱 상품 분류를 가져오지 못했습니다.')
      if (cancelled) return
      const value: CategoryContext = body.context
      setContext(value); setQuery(value.categoryName || value.productName)
      await search(value)
    }).catch((cause) => { if (!cancelled) { setError(cause instanceof Error ? cause.message : '상품 분류를 가져오지 못했습니다.'); setBusy('') } })
    return () => { cancelled = true; invalidate() }
  }, [sourceCode])

  async function connect(category: SupplierCategory) {
    const session = ++generation.current
    setBusy('쿠팡 공식 견적서 연결 중'); setError('')
    try {
      const file = await getSupplierCategoryTemplate(category.id)
      if (session !== generation.current) return
      const response = await fetch(`${API}/category-template`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: category.id, file }) })
      const body = await response.json()
      if (!response.ok || !body.template) throw new Error(body.error || '공식 견적서를 확인하지 못했습니다.')
      if (session !== generation.current) return
      onConnect(body.template, category.id)
    } catch (cause) { if (session === generation.current) setError(cause instanceof Error ? cause.message : '양식을 연결하지 못했습니다.') }
    finally { if (session === generation.current) setBusy('') }
  }

  if (!sourceCode) return <p className="text-xs text-muted-foreground">펀타스틱 상품이 연결되면 등록된 분류로 쿠팡 카테고리를 검색합니다. 세트는 구성에 맞는 공식 양식을 직접 연결해주세요.</p>
  return <section aria-label="펀타 카테고리 기반 쿠팡 추천" className="space-y-3 rounded-md border border-blue-200 bg-blue-50/30 p-3">
    <div><h3 className="text-xs font-semibold">펀타 카테고리 기반 쿠팡 추천</h3>{context && <p className="mt-1 text-xs">펀타 등록 분류: <strong>{context.categoryPath || context.categoryName || '등록된 분류 없음'}</strong></p>}</div>
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (context) void search(context, query.trim()) }}>
      <input aria-label="쿠팡 카테고리 보완 검색어" maxLength={200} className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품 유형으로 보완 검색" />
      <button className={button} disabled={!context || !!busy}><Search className="size-3.5" />쿠팡 후보 다시 검색</button>
    </form>
    {context && <p className="text-[11px] text-muted-foreground">등록 분류를 먼저 검색하고 상품명·키워드로 보완합니다. 펀타 분류가 넓으면 실제 상품 유형을 추가해주세요.</p>}
    {busy && <p role="status" className="flex items-center gap-1 text-xs text-blue-700"><Loader2 className="size-3 animate-spin" />{busy}</p>}
    {error && <p role="alert" className="text-xs text-amber-800">{error}</p>}
    {needsExtension && <div className="space-y-1 text-xs"><a className={button} href={`${API}/extension`} download><Download className="size-3.5" />쿠팡 등록 확장 업데이트</a><p className="text-[11px] text-muted-foreground">압축을 푼 폴더를 Chrome 확장 프로그램에 연결하고 이 화면에서 다시 검색하세요. 서플라이어허브 로그인도 필요합니다.</p></div>}
    {searched && !categories.length && <p className="text-xs text-muted-foreground">허브에서 일치하는 분류를 찾지 못했습니다. 보완 검색어를 바꿔 다시 검색해주세요.</p>}
    {!!categories.length && <div className="max-h-72 space-y-2 overflow-y-auto">{categories.map((category) => <div key={category.id} className="flex items-center justify-between gap-3 rounded-md border bg-background p-2">
      <div className="min-w-0"><p className="text-xs font-medium">{category.path || category.name}</p><p className="mt-1 text-[11px] text-muted-foreground">검색 근거: {category.matchedQueries.join(' · ')}</p></div>
      <button type="button" className={`${button} shrink-0`} disabled={!!busy} onClick={() => void connect(category)}>이 분류 양식 연결</button>
    </div>)}</div>}
  </section>
}
