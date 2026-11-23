'use client'

import { Download, Printer } from 'lucide-react'
import { BoxMeasurementCells } from './box-measurement-cells'
import { useChinaWorkGuard } from './unsaved-china-work'
import type { SavedBoxSummary } from './china-shipments-board'

const boxNumberCollator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })
const productKey = (item: SavedBoxSummary['items'][number]['item']) => JSON.stringify([item.sku, item.optionName ?? ''])
export function SavedBoxContentsPanel({ shipmentId, summaries, filter, editable, isPending, onFilterChange }: {
  shipmentId: string; summaries: SavedBoxSummary[]; filter: 'all' | 'saved'; editable: boolean; isPending: boolean
  onFilterChange: (filter: 'all' | 'saved') => void
}) {
  const guard = useChinaWorkGuard()
  const savedBoxes = summaries.filter((box) => box.quantity > 0)
  const visibleBoxes = [...(filter === 'all' ? summaries : savedBoxes)].sort((left, right) => boxNumberCollator.compare(left.box.boxNo, right.box.boxNo))
  const canEditBox = (summary: SavedBoxSummary) => editable && summary.box.editable && summary.box.status === 'open'
  return <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="saved-box-contents-title">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
      <h3 id="saved-box-contents-title" className="font-semibold">저장된 박스 현황</h3>
      <div role="group" aria-label="저장된 박스 필터" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={filter === 'saved'} onClick={() => { if (filter !== 'saved') guard.requestNavigation(() => onFilterChange('saved')) }} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">저장된 박스 (내용 있음) {savedBoxes.length.toLocaleString('ko-KR')}</button>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => { if (filter !== 'all') guard.requestNavigation(() => onFilterChange('all')) }} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">전체 박스 {summaries.length.toLocaleString('ko-KR')}</button>
      </div>
    </div>
    {!visibleBoxes.length ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">저장된 박스가 없습니다. 품목별 박스분할을 저장하면 이곳에서 내용과 수량을 확인할 수 있습니다.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1100px] table-fixed border-collapse text-sm">
      <caption className="sr-only">박스번호 순 적재 상품, 수량, 규격·중량, 쉽먼트 인쇄 및 다운로드</caption>
      <colgroup><col className="w-16" /><col /><col className="w-20" />{[80, 80, 80, 94, 90, 210].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead className="bg-muted/30 text-xs text-muted-foreground"><tr>{['박스번호', '적재 상품', '총수량', '가로(cm)', '세로(cm)', '높이(cm)', '총중량(kg)', 'CBM', '부착용 쉽먼트'].map(label => <th key={label} scope="col" className={`whitespace-nowrap border-r px-2 py-1.5 font-medium last:border-r-0 ${label === '총수량' ? 'text-right' : 'text-left'}`}>{label}</th>)}</tr></thead>
      <tbody>{visibleBoxes.map((summary) => {
        const mixed = new Set(summary.items.map(({ item }) => productKey(item))).size > 1
        const boxEditable = canEditBox(summary)
        const href = `/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/labels?boxId=${encodeURIComponent(summary.box.id)}`
        return <tr key={summary.box.id} aria-label={`박스 ${summary.box.boxNo}`} className="border-t align-middle hover:bg-muted/20 [&>td]:border-r [&>td:last-child]:border-r-0">
          <td className="px-3 py-1.5 whitespace-nowrap font-semibold tabular-nums"><span data-no-translate>{summary.box.boxNo}</span>{mixed && <p className="text-xs text-amber-800">혼합박스</p>}</td>
          <td className="overflow-hidden px-2 py-1 text-xs leading-5"><div className="min-w-0">{summary.items.length ? <ul className="divide-y divide-slate-100">{summary.items.map(({ item }) => <li key={item.id} className="py-0.5"><span data-no-translate className="block min-w-0 truncate text-xs leading-5">{item.sku} · {item.productName}{item.optionName ? ` · ${item.optionName}` : ''}{item.chineseProductName ? ` / ${item.chineseProductName}` : ''}</span></li>)}</ul> : <span className="text-muted-foreground">{summary.quantity ? '품목 정보를 찾지 못했습니다.' : '내용 없음'}</span>}</div></td>
          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-900">{summary.quantity.toLocaleString('ko-KR')}개</td>
          <BoxMeasurementCells key={`${summary.box.id}:${summary.box.lengthCm}:${summary.box.widthCm}:${summary.box.heightCm}:${summary.box.grossWeightKg}`} shipmentId={shipmentId} box={summary.box} editable={boxEditable} isPending={isPending} />
          <td className="px-3 py-1.5"><div>{summary.quantity > 0 ? <><a href={`${href}&format=print`} target="_blank" rel="noopener noreferrer" aria-label={`${summary.box.boxNo} 박스 쉽먼트 바로 인쇄`} className="mr-1 inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs"><Printer className="size-3.5" />바로 인쇄</a><a href={href} aria-label={`${summary.box.boxNo} 박스 부착용 쉽먼트 다운로드`} className="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs"><Download className="size-3.5" />박스별 다운로드</a></> : '-'}</div></td>
        </tr>
      })}</tbody>
    </table></div>}
  </section>
}