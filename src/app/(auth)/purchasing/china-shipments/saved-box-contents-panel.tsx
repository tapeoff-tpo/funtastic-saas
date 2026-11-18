'use client'

import { Download, Printer } from 'lucide-react'
import { BoxDimensionsEditor, PackageWeightEditor } from './outbound-package-editors'
import { useChinaWorkGuard } from './unsaved-china-work'
import type { SavedBoxSummary } from './china-shipments-board'

const boxNumberCollator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })
const productKey = (item: SavedBoxSummary['items'][number]['item']) => JSON.stringify([item.sku, item.optionName ?? ''])

export function SavedBoxContentsPanel({ shipmentId, summaries, filter, editable, isPending, onFilterChange, onEditItem }: {
  shipmentId: string; summaries: SavedBoxSummary[]; filter: 'all' | 'saved'; editable: boolean; isPending: boolean
  onFilterChange: (filter: 'all' | 'saved') => void; onEditItem: (itemId: string) => void
}) {
  const guard = useChinaWorkGuard()
  const savedBoxes = summaries.filter((box) => box.quantity > 0)
  const visibleBoxes = [...(filter === 'all' ? summaries : savedBoxes)].sort((left, right) => boxNumberCollator.compare(left.box.boxNo, right.box.boxNo))
  return <section className="overflow-hidden rounded-lg border bg-background" aria-labelledby="saved-box-contents-title">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-3">
      <h3 id="saved-box-contents-title" className="font-semibold">저장된 박스 현황</h3>
      <div role="group" aria-label="저장된 박스 필터" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={filter === 'saved'} onClick={() => { if (filter !== 'saved') guard.requestNavigation(() => onFilterChange('saved')) }} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">저장된 박스 (내용 있음) {savedBoxes.length.toLocaleString('ko-KR')}</button>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => { if (filter !== 'all') guard.requestNavigation(() => onFilterChange('all')) }} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">전체 박스 {summaries.length.toLocaleString('ko-KR')}</button>
      </div>
    </div>
    {!visibleBoxes.length ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">저장된 박스가 없습니다. 품목별 박스분할을 저장하면 이곳에서 내용과 수량을 확인할 수 있습니다.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-sm">
      <caption className="sr-only">박스번호 순 적재 상품, 수량, 규격·중량, 파렛트 위치, 쉽먼트 인쇄 및 다운로드</caption>
      <thead className="bg-muted/10 text-xs text-muted-foreground"><tr>{['박스번호', '적재 상품', '총수량', '박스 규격·중량', '파렛트 위치', '부착용 쉽먼트', '관리'].map((label) => <th key={label} className="px-3 py-2 text-left font-medium">{label}</th>)}</tr></thead>
      <tbody>{visibleBoxes.map((summary) => {
        const mixed = new Set(summary.items.map(({ item }) => productKey(item))).size > 1
        const boxEditable = editable && summary.box.editable && summary.box.status === 'open'
        const href = `/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/labels?boxId=${encodeURIComponent(summary.box.id)}`
        return <tr key={summary.box.id} aria-label={`박스 ${summary.box.boxNo}`} className="border-t align-top">
          <td className="px-3 py-3 font-medium"><span data-no-translate>{summary.box.boxNo}</span>{mixed && <span className="ml-2 inline-block whitespace-nowrap rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">혼합박스</span>}</td>
          <td className="px-3 py-3 text-xs leading-5">{summary.items.length ? <ul className="space-y-1">{summary.items.map(({ item, quantity }) => <li key={item.id}><span data-no-translate>{item.sku} · {item.productName}{item.optionName ? ` · ${item.optionName}` : ''}{item.chineseProductName ? ` / ${item.chineseProductName}` : ''}</span>{' '}<span>{quantity.toLocaleString('ko-KR')}개</span></li>)}</ul> : <span className="text-muted-foreground">{summary.quantity ? '품목 정보를 찾지 못했습니다.' : '내용 없음'}</span>}</td>
          <td className="px-3 py-3 tabular-nums">{summary.quantity.toLocaleString('ko-KR')}개</td>
          <td className="min-w-[350px] space-y-3 px-3 py-3">
            <BoxDimensionsEditor key={`${summary.box.id}:${summary.box.lengthCm}:${summary.box.widthCm}:${summary.box.heightCm}`} shipmentId={shipmentId} box={summary.box} editable={boxEditable} isPending={isPending} />
            <PackageWeightEditor key={`${summary.box.id}:${summary.box.grossWeightKg}`} shipmentId={shipmentId} packageId={summary.box.id} packageNo={summary.box.boxNo} kind="box" initialWeight={summary.box.grossWeightKg} editable={boxEditable} isPending={isPending} compact />
          </td>
          <td className="px-3 py-3 text-xs">{summary.palletNo ? <>파렛트 <span data-no-translate>{summary.palletNo}</span></> : <span className="text-muted-foreground">미배정</span>}</td>
          <td className="px-3 py-3">{summary.quantity > 0 ? <><a href={`${href}&format=print`} target="_blank" rel="noopener noreferrer" aria-label={`${summary.box.boxNo} 박스 쉽먼트 바로 인쇄`} className="mb-1 mr-1 inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"><Printer className="size-3.5" />바로 인쇄</a><a href={href} aria-label={`${summary.box.boxNo} 박스 부착용 쉽먼트 다운로드`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"><Download className="size-3.5" />박스별 다운로드</a></> : '-'}</td>
          <td className="px-3 py-3">{summary.quantity > 0 && boxEditable ? <div className="flex flex-col gap-1">{summary.items.map(({ item }) => <button key={item.id} type="button" disabled={isPending || guard.busy} onClick={() => guard.requestNavigation(() => onEditItem(item.id))} aria-label={mixed ? `${summary.box.boxNo} 박스 ${item.sku} 내용 수정` : `${summary.box.boxNo} 박스 내용 수정`} className="h-8 whitespace-nowrap rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-50">{mixed ? <><span data-no-translate>{item.sku}</span> 수정</> : '수정'}</button>)}</div> : '-'}</td>
        </tr>
      })}</tbody>
    </table></div>}
  </section>
}
