'use client'

import { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import type { SavedBoxSummary } from './china-shipments-board'

const productKey = (item: SavedBoxSummary['items'][number]['item']) => JSON.stringify([item.sku, item.optionName ?? ''])

export function groupSavedBoxes(summaries: SavedBoxSummary[]) {
  const products = new Map<string, { key: string; item: SavedBoxSummary['items'][number]['item']; boxes: SavedBoxSummary[] }>()
  const mixed: SavedBoxSummary[] = []
  const other: SavedBoxSummary[] = []
  for (const box of summaries) {
    const identities = new Set(box.items.map(({ item }) => productKey(item)))
    if (identities.size > 1) { mixed.push(box); continue }
    const first = box.items[0]?.item
    if (!first) { other.push(box); continue }
    const key = productKey(first)
    const group = products.get(key)
    if (group) group.boxes.push(box)
    else products.set(key, { key, item: first, boxes: [box] })
  }
  return { products: [...products.values()], mixed, other }
}

export function SavedBoxContentsPanel({ shipmentId, summaries, filter, editable, isPending, onFilterChange, onEditItem }: {
  shipmentId: string; summaries: SavedBoxSummary[]; filter: 'all' | 'saved'; editable: boolean; isPending: boolean
  onFilterChange: (filter: 'all' | 'saved') => void; onEditItem: (itemId: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const savedBoxes = summaries.filter((box) => box.quantity > 0)
  const visibleBoxes = filter === 'all' ? summaries : savedBoxes
  const { products, mixed, other } = groupSavedBoxes(visibleBoxes)
  const toggle = (key: string) => setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  function boxTable(boxes: SavedBoxSummary[], mixedBoxes = false) {
    return <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
      <caption className="sr-only">박스별 적재 상품, 수량, 파렛트 위치, 쉽먼트 인쇄 및 다운로드</caption>
      <thead className="bg-muted/10 text-xs text-muted-foreground"><tr>{['박스번호', '적재 상품', '총수량', '파렛트 위치', '부착용 쉽먼트', '관리'].map((label) => <th key={label} className="px-3 py-2 text-left font-medium">{label}</th>)}</tr></thead>
      <tbody>{boxes.map((summary) => {
        const href = `/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/labels?boxId=${encodeURIComponent(summary.box.id)}`
        return <tr key={summary.box.id} className="border-t align-top">
          <td className="px-3 py-3 font-medium"><span data-no-translate>{summary.box.boxNo}</span>{mixedBoxes && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">혼합박스</span>}</td>
          <td className="px-3 py-3 text-xs leading-5">{summary.items.length ? <ul className="space-y-1">{summary.items.map(({ item, quantity }) => <li key={item.id}><span data-no-translate>{item.sku} · {item.productName}{item.optionName ? ` · ${item.optionName}` : ''}{item.chineseProductName ? ` / ${item.chineseProductName}` : ''}</span>{' '}<span>{quantity.toLocaleString('ko-KR')}개</span></li>)}</ul> : <span className="text-muted-foreground">{summary.quantity ? '품목 정보를 찾지 못했습니다.' : '내용 없음'}</span>}</td>
          <td className="px-3 py-3 tabular-nums">{summary.quantity.toLocaleString('ko-KR')}개</td>
          <td className="px-3 py-3 text-xs">{summary.palletNo ? <>파렛트 <span data-no-translate>{summary.palletNo}</span></> : <span className="text-muted-foreground">미배정</span>}</td>
          <td className="px-3 py-3">{summary.quantity > 0 ? <><a href={`${href}&format=print`} target="_blank" rel="noopener noreferrer" aria-label={`${summary.box.boxNo} 박스 쉽먼트 바로 인쇄`} className="mb-1 mr-1 inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"><Printer className="size-3.5" />바로 인쇄</a><a href={href} aria-label={`${summary.box.boxNo} 박스 부착용 쉽먼트 다운로드`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"><Download className="size-3.5" />박스별 다운로드</a></> : '-'}</td>
          <td className="px-3 py-3">{summary.quantity > 0 && editable ? <div className="flex flex-col gap-1">{summary.items.map(({ item }) => <button key={item.id} type="button" disabled={isPending} onClick={() => onEditItem(item.id)} aria-label={mixedBoxes ? `${summary.box.boxNo} 박스 ${item.sku} 내용 수정` : `${summary.box.boxNo} 박스 내용 수정`} className="h-8 whitespace-nowrap rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-50">{mixedBoxes ? <><span data-no-translate>{item.sku}</span> 수정</> : '수정'}</button>)}</div> : '-'}</td>
        </tr>
      })}</tbody>
    </table></div>
  }
  return <section className="overflow-hidden rounded-lg border bg-background" aria-labelledby="saved-box-contents-title">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-3">
      <h3 id="saved-box-contents-title" className="font-semibold">저장된 박스 현황</h3>
      <div role="group" aria-label="저장된 박스 필터" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={filter === 'saved'} onClick={() => onFilterChange('saved')} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">저장된 박스 (내용 있음) {savedBoxes.length.toLocaleString('ko-KR')}</button>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => onFilterChange('all')} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">전체 박스 {summaries.length.toLocaleString('ko-KR')}</button>
      </div>
    </div>
    {!visibleBoxes.length ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">저장된 박스가 없습니다. 품목별 박스분할을 저장하면 이곳에서 내용과 수량을 확인할 수 있습니다.</p> : <div className="space-y-4 p-3">
      {products.length > 0 && <section aria-label="동일 상품 박스" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">동일 상품 박스</h4><div className="flex gap-2"><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setExpanded(new Set(products.map((group) => group.key)))}>전체 펼치기</button><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setExpanded(new Set())}>전체 접기</button></div></div>
        {products.map((group) => <div key={group.key} className="overflow-hidden rounded-md border">
          <button type="button" aria-expanded={expanded.has(group.key)} onClick={() => toggle(group.key)} className="flex w-full flex-wrap items-center justify-between gap-2 bg-muted/20 px-3 py-3 text-left text-sm">
            <span data-no-translate className="font-medium">{group.item.sku} · {group.item.productName}{group.item.optionName ? ` · ${group.item.optionName}` : ''}{group.item.chineseProductName ? ` / ${group.item.chineseProductName}` : ''}</span>
            <span className="flex items-center gap-3"><span>{group.boxes.length.toLocaleString('ko-KR')}박스 · {group.boxes.reduce((total, box) => total + box.quantity, 0).toLocaleString('ko-KR')}개</span><span>{expanded.has(group.key) ? '접기' : '펼치기'}</span></span>
          </button>{expanded.has(group.key) && boxTable(group.boxes)}
        </div>)}
      </section>}
      {mixed.length > 0 && <section aria-label="혼합박스" className="overflow-hidden rounded-md border border-amber-200"><h4 className="bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-900">혼합박스 · {mixed.length.toLocaleString('ko-KR')}박스</h4>{boxTable(mixed, true)}</section>}
      {other.length > 0 && <section aria-label="기타 박스" className="overflow-hidden rounded-md border"><h4 className="bg-muted/20 px-3 py-3 text-sm font-semibold">기타 박스</h4>{boxTable(other)}</section>}
    </div>}
  </section>
}
