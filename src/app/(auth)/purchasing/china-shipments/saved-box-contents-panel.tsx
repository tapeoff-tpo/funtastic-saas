'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { mergeChinaOutboundBoxesAction } from '../saas-china-actions'
import { largestChinaOutboundBox } from '@/lib/purchasing/china-outbound-packaging'
import { Download, Printer } from 'lucide-react'
import { ItemCodeCell } from './item-code-cell'
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
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [pending, start] = useTransition()
  const savedBoxes = summaries.filter((box) => box.quantity > 0)
  const visibleBoxes = [...(filter === 'all' ? summaries : savedBoxes)].sort((left, right) => boxNumberCollator.compare(left.box.boxNo, right.box.boxNo))
  const canEditBox = (summary: SavedBoxSummary) => editable && summary.box.editable && summary.box.status === 'open'
  const selectedBoxes = summaries.filter((summary) => selected.includes(summary.box.id) && canEditBox(summary) && summary.quantity > 0)
  const target = largestChinaOutboundBox(selectedBoxes.map((summary) => summary.box))
  async function merge() {
    if (selectedBoxes.length < 2) return false
    if (guard.hasDraftKind('box') || guard.hasDraftKind('pallet')) { toast.error('박스·파렛트 변경사항을 먼저 저장해주세요.'); return false }
    const result = await mergeChinaOutboundBoxesAction({ shipmentId, boxIds: selectedBoxes.map((summary) => summary.box.id) })
    if (!result.ok) { toast.error(result.error); return false }
    setSelected([]); dialog.current?.close(); router.refresh(); toast.success('선택한 박스를 합쳤습니다.'); return true
  }
  return <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="saved-box-contents-title">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-3"><h3 id="saved-box-contents-title" className="font-semibold">저장된 박스 현황</h3>
      {editable && <button type="button" disabled={selectedBoxes.length < 2 || isPending || pending || guard.busy} onClick={() => dialog.current?.showModal()} className="h-7 rounded border bg-background px-2 text-xs disabled:opacity-40">선택 박스 합치기 ({selectedBoxes.length})</button>}</div>
      <div role="group" aria-label="저장된 박스 필터" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={filter === 'saved'} onClick={() => { if (filter !== 'saved') guard.requestNavigation(() => onFilterChange('saved')) }} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">저장된 박스 (내용 있음) {savedBoxes.length.toLocaleString('ko-KR')}</button>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => { if (filter !== 'all') guard.requestNavigation(() => onFilterChange('all')) }} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">전체 박스 {summaries.length.toLocaleString('ko-KR')}</button>
      </div>
    </div>
    {!visibleBoxes.length ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">저장된 박스가 없습니다. 품목별 박스분할을 저장하면 이곳에서 내용과 수량을 확인할 수 있습니다.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1350px] table-fixed border-collapse text-sm">
      <caption className="sr-only">박스번호 순 적재 상품, 수량, 규격·중량, 쉽먼트 인쇄 및 다운로드</caption>
      <colgroup><col className="w-16" /><col className="w-28" /><col className="w-52" /><col className="w-32" /><col className="w-20" />{[260, 94, 90, 240, 94].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead className="bg-muted/30 text-xs text-muted-foreground"><tr>{['박스번호', '품목코드', '상품명', '옵션', '수량', '규격 가로×세로×높이(cm)', '총중량(kg)', 'CBM', '부착용 쉽먼트', '저장'].map(label => <th key={label} scope="col" className={`whitespace-nowrap px-2 py-1.5 font-medium text-left`}>{label}</th>)}</tr></thead>
      <tbody>{visibleBoxes.map((summary) => {
        const mixed = new Set(summary.items.map(({ item }) => productKey(item))).size > 1
        const boxEditable = canEditBox(summary)
        const href = `/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/labels?boxId=${encodeURIComponent(summary.box.id)}`
        return <tr key={summary.box.id} aria-label={`박스 ${summary.box.boxNo}`} className="border-t align-middle hover:bg-muted/20">
          <td className="px-3 py-1.5 whitespace-nowrap font-semibold tabular-nums"><label className="flex items-center gap-2">{editable && <input type="checkbox" aria-label={`박스 ${summary.box.boxNo} 합치기 선택`} checked={selected.includes(summary.box.id)} disabled={!boxEditable || summary.quantity <= 0 || isPending || pending || guard.busy}
            onChange={(event) => setSelected((current) => event.target.checked ? [...current, summary.box.id] : current.filter((id) => id !== summary.box.id))} />}<span data-no-translate>{summary.box.boxNo}</span></label>{mixed && <p className="text-xs text-amber-800">혼합박스</p>}</td>
          {(['code', 'name', 'option', 'quantity'] as const).map((column) => <td key={column} className="overflow-hidden px-2 py-1 text-xs leading-6">
            {summary.items.length ? summary.items.map(({ item, quantity }) => <div key={item.id} className="h-6 truncate" data-no-translate title={column === 'name' ? item.productName : column === 'option' ? item.optionName ?? '' : undefined}>
              {column === 'code' ? <ItemCodeCell code={item.sku} /> : column === 'name' ? item.productName : column === 'option' ? item.optionName || '—' : `${quantity.toLocaleString('ko-KR')}개`}
            </div>) : '—'}
          </td>)}
          <BoxMeasurementCells key={`${summary.box.id}:${summary.box.lengthCm}:${summary.box.widthCm}:${summary.box.heightCm}:${summary.box.grossWeightKg}`} shipmentId={shipmentId} box={summary.box} editable={boxEditable} isPending={isPending} actions={
          <td className="px-2 py-1"><div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">{summary.quantity > 0 ? <><a href={`${href}&format=print`} target="_blank" rel="noopener noreferrer" aria-label={`${summary.box.boxNo} 박스 쉽먼트 바로 인쇄`} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-xs"><Printer className="size-3.5" />바로 인쇄</a><a href={href} aria-label={`${summary.box.boxNo} 박스 부착용 쉽먼트 다운로드`} className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-xs"><Download className="size-3.5" />박스별 다운로드</a></> : '-'}</div></td>
          } />
        </tr>
      })}</tbody>
    </table></div>}
    <dialog ref={dialog} aria-label="선택 박스 합치기 확인" onCancel={(event) => { if (pending || guard.busy) event.preventDefault() }} className="m-auto w-[min(32rem,95vw)] space-y-3 rounded-xl border bg-background p-4 text-sm text-foreground backdrop:bg-black/40">
      <h3 className="font-semibold">선택 박스 합치기</h3>
      <p>박스 {selectedBoxes.map((summary) => summary.box.boxNo).join(', ')} · 총 {selectedBoxes.reduce((sum, summary) => sum + summary.quantity, 0).toLocaleString('ko-KR')}개</p>
      <ul className="max-h-48 overflow-y-auto">{selectedBoxes.map((summary) => <li key={summary.box.id}>박스 {summary.box.boxNo}: {summary.items.map(({ item, quantity }) => `${item.productName} ${item.optionName ?? ''} (${quantity}개)`).join(' / ')}</li>)}</ul>
      <p>선택한 박스 중 가장 큰 박스 {target?.boxNo}의 규격을 사용합니다.</p>
      <div className="flex justify-end gap-2"><button type="button" disabled={pending || guard.busy} onClick={() => dialog.current?.close()} className="rounded border px-3 py-1.5">취소</button>
        <button type="button" disabled={selectedBoxes.length < 2 || pending || isPending || guard.busy} onClick={() => start(async () => { await guard.runTask(merge) })} className="rounded bg-primary px-3 py-1.5 text-primary-foreground">합치기 확인</button></div>
    </dialog>
  </section>
}