'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Search } from 'lucide-react'
import type { CategoryContext } from '@/lib/coupang-registration/category-context'
import type { RegistrationDraft } from '@/lib/coupang-registration/model'
import { getSupplierCategoryTemplate, pingSupplierExtension, searchSupplierCategories, type SupplierCategory } from '@/lib/coupang-registration/supplier-bridge'

const API = '/api/operations/coupang-registration'
const button = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-40'
type ConnectedTemplate = RegistrationDraft['templates'][number]
type Props = { sourceCode: string; selectedSheetName?: string; onConnect: (template: ConnectedTemplate, categoryId: string) => void }

export function CategoryRecommendations(props: Props) {
  return <CategoryRecommendationPanel key={props.sourceCode} {...props} />
}

function CategoryRecommendationPanel({ sourceCode, selectedSheetName = '', onConnect }: Props) {
  const [context, setContext] = useState<CategoryContext>()
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState<SupplierCategory[]>([])
  const [busy, setBusy] = useState(sourceCode ? '펀타스틱 상품 분류 확인 중' : '')
  const [error, setError] = useState('')
  const [needsExtension, setNeedsExtension] = useState(false)
  const [searched, setSearched] = useState(false)
  const [connectingId, setConnectingId] = useState('')
  const generation = useRef(0)
  const selectedId = /^QF_(\d+)_/.exec(selectedSheetName)?.[1] ?? ''

  async function search(value: CategoryContext, override = '') {
    const session = ++generation.current
    setBusy('펀타 카테고리로 쿠팡 검색 중'); setError(''); setCategories([]); setSearched(false)
    try {
      const extension = await pingSupplierExtension()
      if (session !== generation.current) return
      if (!extension.supportsCategories) {
        setNeedsExtension(true)
        throw new Error(extension.connected
          ? `설치된 쿠팡 등록 확장 ${extension.version || ''}에는 카테고리 검색 기능이 없습니다. 최신 확장으로 업데이트해주세요.`
          : '쿠팡 등록 확장과 이 페이지가 연결되지 않았습니다. 설치된 확장의 새로고침 버튼을 누른 뒤 SaaS 페이지도 새로고침하고 다시 검색해주세요.')
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
    setBusy('쿠팡 공식 견적서 연결 중'); setConnectingId(category.id); setError('')
    try {
      const file = await getSupplierCategoryTemplate(category.id)
      if (session !== generation.current) return
      const response = await fetch(`${API}/category-template`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: category.id, file }) })
      const body = await response.json()
      if (!response.ok || !body.template) throw new Error(body.error || '공식 견적서를 확인하지 못했습니다.')
      if (session !== generation.current) return
      onConnect(body.template, category.id)
    } catch (cause) { if (session === generation.current) setError(cause instanceof Error ? cause.message : '양식을 연결하지 못했습니다.') }
    finally { if (session === generation.current) { setBusy(''); setConnectingId('') } }
  }

  const placeholder = busy ? busy : needsExtension ? '쿠팡 등록 확장 연결 필요' : searched && !categories.length ? '검색 결과 없음 · 검색어를 보완해주세요' : !sourceCode ? '펀타 상품 연결 또는 양식 직접 선택' : '추천 쿠팡 카테고리 선택'
  return <section aria-label="펀타 카테고리 기반 쿠팡 추천" className="space-y-2">
    <label className="grid gap-1.5 text-xs"><span className="font-medium">쿠팡 카테고리 양식</span>
      <select aria-label="쿠팡 카테고리 양식" className="h-8 w-full min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" value={connectingId || selectedId} disabled={!!busy || !categories.length} onChange={(event) => { const category = categories.find((item) => item.id === event.target.value); if (category) void connect(category) }}>
        <option value="">{placeholder}</option>
        {selectedId && !categories.some((category) => category.id === selectedId) && <option value={selectedId}>{selectedSheetName.replace(/^QF_\d+_/, '').replaceAll('_', ' > ')}</option>}
        {categories.map((category) => <option key={category.id} value={category.id}>{category.path || category.name}</option>)}
      </select>
    </label>
    {context && <p className="text-[11px] text-muted-foreground">펀타 등록 분류: <strong>{context.categoryPath || context.categoryName || '등록된 분류 없음'}</strong></p>}
    {!sourceCode && <p className="text-xs text-muted-foreground">펀타스틱 상품이 연결되면 등록된 분류로 쿠팡 카테고리를 검색합니다. 세트는 구성에 맞는 공식 양식을 직접 연결해주세요.</p>}
    {categories.length > 0 && <p className="text-[11px] text-muted-foreground">펀타 분류·상품명·키워드로 찾은 쿠팡 후보 {categories.length}개입니다. 선택하면 공식 견적서와 필수 입력항목을 연결합니다.</p>}
    {!!selectedId && <p className="text-[11px] text-blue-700">현재 연결: {selectedSheetName.replace(/^QF_\d+_/, '').replaceAll('_', ' > ')}</p>}
    {sourceCode && <>
    <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (context) void search(context, query.trim()) }}>
      <input aria-label="쿠팡 카테고리 보완 검색어" maxLength={200} className="h-8 min-w-40 flex-1 rounded-md border bg-background px-2 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품 유형으로 보완 검색" />
      <button className={button} disabled={!context || !!busy}><Search className="size-3.5" />쿠팡 후보 다시 검색</button>
    </form>
    {context && <p className="text-[11px] text-muted-foreground">등록 분류를 먼저 검색하고 상품명·키워드로 보완합니다. 펀타 분류가 넓으면 실제 상품 유형을 추가해주세요.</p>}
    </>}
    {busy && <p role="status" className="flex items-center gap-1 text-xs text-blue-700"><Loader2 className="size-3 animate-spin" />{busy}</p>}
    {error && <p role="alert" className="text-xs text-amber-800">{error}</p>}
    {needsExtension && <div className="space-y-1 text-xs"><a className={button} href={`${API}/extension`} download><Download className="size-3.5" />쿠팡 등록 확장 업데이트</a><p className="text-[11px] text-muted-foreground">압축을 푼 폴더를 Chrome 확장 프로그램에 연결하고 이 화면에서 다시 검색하세요. 서플라이어허브 로그인도 필요합니다.</p></div>}
    {searched && !categories.length && <p className="text-xs text-muted-foreground">허브에서 일치하는 분류를 찾지 못했습니다. 보완 검색어를 바꿔 다시 검색해주세요.</p>}
    {!!selectedId && categories.some((category) => category.id === selectedId) && <p className="text-[11px] text-muted-foreground">검색 근거: {categories.find((category) => category.id === selectedId)?.matchedQueries.join(' · ')}</p>}
  </section>
}
