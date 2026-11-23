'use client'

import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Layers3 } from 'lucide-react'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundCbm, formatChinaOutboundBoxDimensions } from '@/lib/purchasing/china-outbound-dimensions'
import { PackageWeightEditor } from './outbound-package-editors'
import { PalletFinalMeasurements } from './pallet-final-measurements'
import { ItemCodeCell } from './item-code-cell'
import { useChinaWorkGuard } from './unsaved-china-work'
import type { ChinaShipmentDetailView, PalletSummary } from './china-shipments-board'

export function PalletContentsPanel({ shipmentId, summaries, boxItems, items, editable, dimensionsEditable = editable, isPending, assignmentEditor, unassignedBoxes = [], initiallyExpanded = false }: {
  shipmentId: string; summaries: PalletSummary[]; boxItems: ChinaShipmentDetailView['boxItems']; items: ChinaShipmentDetailView['items']
  editable: boolean; dimensionsEditable?: boolean; isPending: boolean; assignmentEditor?: ReactNode; unassignedBoxes?: ChinaShipmentDetailView['boxes']; initiallyExpanded?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const guard = useChinaWorkGuard()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initiallyExpanded ? summaries.map((summary) => summary.pallet.id) : []))
  const itemById = new Map(items.map((item) => [item.id, item]))
  function toggle(id: string, setter: typeof setExpanded) {
    setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function boxList(boxes: ChinaShipmentDetailView['boxes']) {
    return <div className="overflow-x-auto border-t bg-background"><table aria-label="박스별 적재리스트" className="w-full min-w-[1100px] table-fixed text-xs">
      <colgroup>{[70, 110, 220, 140, 140, 80, 210, 100, 90].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
      <thead className="bg-muted/30 text-muted-foreground"><tr>{['박스번호', '품목코드', '상품명', '중국어 상품명', '옵션', '적재수량', '규격 가로×세로×높이(cm)', '총중량(kg)', 'CBM'].map((label) => <th key={label} className="whitespace-nowrap px-2 py-2 text-left font-medium">{label}</th>)}</tr></thead>
      <tbody>{boxes.flatMap((box) => {
        const allocations = boxItems.filter((allocation) => allocation.boxId === box.id)
        return (allocations.length ? allocations : [null]).map((allocation, index) => {
          const item = allocation ? itemById.get(allocation.shipmentItemId) : null
          return <tr key={allocation?.id ?? box.id} className="border-t hover:bg-muted/20">
            {index === 0 && <td rowSpan={Math.max(allocations.length, 1)} className="px-2 py-1 font-semibold" data-no-translate>{box.boxNo}</td>}
            <td className="overflow-hidden px-2 py-1">{item ? <ItemCodeCell code={item.sku} /> : '—'}</td>
            <td className="px-2 py-1"><span className="block truncate" title={item?.productName} data-no-translate>{item?.productName ?? '—'}</span></td>
            <td className="px-2 py-1"><span className="block truncate" title={item?.chineseProductName ?? ''} data-no-translate>{item?.chineseProductName || '—'}</span></td>
            <td className="px-2 py-1"><span className="block truncate" title={item?.optionName ?? ''} data-no-translate>{item?.optionName || '—'}</span></td>
            <td className="px-2 py-1 text-right tabular-nums">{allocation?.quantity.toLocaleString('ko-KR') ?? '0'}개</td>
            {index === 0 && <><td rowSpan={Math.max(allocations.length, 1)} className="whitespace-nowrap px-2 py-1">{formatChinaOutboundBoxDimensions(box) ?? '미입력'}</td>
              <td rowSpan={Math.max(allocations.length, 1)} className="px-2 py-1 tabular-nums">{editable ? <PackageWeightEditor key={`${box.id}:${box.grossWeightKg}`} shipmentId={shipmentId} kind="box" packageId={box.id} packageNo={box.boxNo} initialWeight={box.grossWeightKg} editable={editable} isPending={isPending} compact /> : box.grossWeightKg ?? '—'}</td>
              <td rowSpan={Math.max(allocations.length, 1)} className="px-2 py-1 text-right tabular-nums">{formatChinaOutboundCbm(calculateChinaOutboundBoxCbm(box)) ?? '—'}</td></>}
          </tr>
        })
      })}</tbody>
    </table></div>
  }

  const looseCbms = unassignedBoxes.map(calculateChinaOutboundBoxCbm)
  const finalCbms = summaries.map((summary) => calculateChinaOutboundBoxCbm(summary.pallet))
  return <section className="space-y-5" aria-label="사용 파렛트">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">사용 파렛트</h3><div className="flex flex-wrap items-center gap-3 text-sm"><span>{summaries.length} PLT + {unassignedBoxes.length} BOX</span>{assignmentEditor && <button type="button" disabled={isPending || guard.busy} onClick={() => dialog.current?.showModal()} className="rounded-md border px-3 py-1">파렛트 배정 수정</button>}</div></div>
    {summaries.map((summary) => <article key={summary.pallet.id} className={`overflow-hidden rounded-xl border-2 shadow-sm ${expanded.has(summary.pallet.id) ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
      <div className={`overflow-x-auto border-l-4 border-blue-600 ${expanded.has(summary.pallet.id) ? 'bg-blue-50' : 'bg-slate-50'}`}><div className={`flex items-center gap-x-5 gap-y-3 p-4 ${'flex-wrap'}`}>
        <div className="min-w-40 shrink-0 space-y-2">
          <button type="button" aria-expanded={expanded.has(summary.pallet.id)} onClick={() => toggle(summary.pallet.id, setExpanded)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-base font-bold text-white"><Layers3 aria-hidden="true" className="size-4" />파렛트 <span data-no-translate>{summary.palletNo}</span><ChevronDown className={expanded.has(summary.pallet.id) ? "size-4 rotate-180" : "size-4"} /></button><p className="whitespace-nowrap text-xs font-medium text-slate-600">박스 {summary.boxes.length}개 · 상품 {summary.quantity.toLocaleString('ko-KR')}개</p>
        </div>
        <PalletFinalMeasurements key={`${summary.pallet.id}:${summary.pallet.manualCbm}:${summary.pallet.tareWeightKg}:${summary.cbm}`} shipmentId={shipmentId} summary={summary} editable={dimensionsEditable} isPending={isPending} />
      </div></div>
      {summary.boxesWithoutDimensions > 0 && <p className="px-4 pb-3 text-xs text-amber-700">규격 미입력 박스 {summary.boxesWithoutDimensions}개는 제품 적재 CBM에서 제외됩니다.</p>}
      {expanded.has(summary.pallet.id) && <div id={`pallet-contents-${summary.pallet.id}`}>{boxList(summary.boxes)}</div>}
    </article>)}
    {!!unassignedBoxes.length && <details open={initiallyExpanded} className="group overflow-hidden rounded-xl border-2 border-amber-200"><summary className="flex cursor-pointer list-none items-center justify-between border-l-4 border-amber-500 bg-amber-50 p-4 text-sm font-semibold text-amber-950 [&::-webkit-details-marker]:hidden">낱박스 {unassignedBoxes.length}개<span>{looseCbms.some(value => value == null) ? "CBM 미입력" : `${formatChinaOutboundCbm(looseCbms.reduce<number>((sum, value) => sum + (value ?? 0), 0))} CBM`}</span><ChevronDown aria-hidden="true" className="size-5 transition-transform group-open:rotate-180" /></summary>{boxList(unassignedBoxes)}</details>}
    {!!summaries.length && <div className="rounded-lg bg-muted/30 p-3 text-right text-sm"><p className="whitespace-nowrap">제품 적재 CBM 합계: {formatChinaOutboundCbm(summaries.reduce((sum, row) => sum + row.cbm, 0))} CBM</p><p className="whitespace-nowrap font-semibold">최종 파렛트 CBM 합계: {finalCbms.some((value) => value == null) ? '미입력' : `${formatChinaOutboundCbm(finalCbms.reduce<number>((sum, value) => sum + (value ?? 0), 0))} CBM`}</p></div>}
    {assignmentEditor && <dialog ref={dialog} data-purchasing-translate aria-label="파렛트 배정 수정" onCancel={(event) => { if (isPending || guard.busy) event.preventDefault() }} className="m-auto max-h-[90dvh] w-[min(72rem,96vw)] overflow-auto rounded-xl border bg-background p-4 text-foreground backdrop:bg-black/40"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">파렛트 배정 수정</h3><button type="button" disabled={isPending || guard.busy} onClick={() => dialog.current?.close()} className="rounded border px-3 py-1">닫기</button></div>{assignmentEditor}</dialog>}
  </section>
}
