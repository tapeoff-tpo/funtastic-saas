'use client'

import { useRef, useState, useTransition, type ReactNode } from 'react'
import { ChevronDown, Layers3, Package } from 'lucide-react'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundCbm, formatChinaOutboundBoxDimensions } from '@/lib/purchasing/china-outbound-dimensions'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { chinaOutboundFinalTotals } from '@/lib/purchasing/china-outbound-final-totals'
import { saveChinaOutboundBoxCompletionStatusesAction } from '../saas-china-actions'
import { PackageWeightEditor } from './outbound-package-editors'
import { PalletFinalMeasurements } from './pallet-final-measurements'
import { ItemCodeCell } from './item-code-cell'
import { useChinaWorkGuard } from './unsaved-china-work'
import type { ChinaOutboundPalletSavedState } from '@/lib/purchasing/china-outbound-save-state'
import type { ChinaShipmentDetailView, PalletSummary } from './china-shipments-board'

export function PalletContentsPanel({ shipmentId, summaries: serverSummaries, boxItems, items, editable, dimensionsEditable = editable, isPending, assignmentEditor, unassignedBoxes = [], initiallyExpanded = false }: {
  shipmentId: string; summaries: PalletSummary[]; boxItems: ChinaShipmentDetailView['boxItems']; items: ChinaShipmentDetailView['items']
  editable: boolean; dimensionsEditable?: boolean; isPending: boolean; assignmentEditor?: ReactNode; unassignedBoxes?: ChinaShipmentDetailView['boxes']; initiallyExpanded?: boolean
}) {
  const [palletSaves, setPalletSaves] = useState<Record<string, { source: string; pallet: ChinaOutboundPalletSavedState }>>({})
  const summaries = serverSummaries.map((summary) => {
    const saved = palletSaves[summary.pallet.id]
    return saved?.source === JSON.stringify(summary) ? { ...summary, pallet: { ...summary.pallet, ...saved.pallet } } : summary
  })
  const router = useRouter()
  const [savingLoose, startLoose] = useTransition()
  const [savedLooseSignature, setSavedLooseSignature] = useState<string | null>(null)
  const [looseOpen, setLooseOpen] = useState(initiallyExpanded)
  const [finalSnapshot, setFinalSnapshot] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
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

  const looseTotals = chinaOutboundFinalTotals([], unassignedBoxes)
  const totals = chinaOutboundFinalTotals(summaries.map((summary) => summary.pallet), [...summaries.flatMap((summary) => summary.boxes), ...unassignedBoxes])
  const snapshot = JSON.stringify({ totals, pallets: summaries.map((summary) => summary.pallet), boxes: [...summaries.flatMap((summary) => summary.boxes), ...unassignedBoxes] })
  const looseSignature = JSON.stringify(unassignedBoxes)
  const looseConfirmed = savedLooseSignature === looseSignature || unassignedBoxes.every((box) => box.completionStatus === 'completed')
  const allPalletsConfirmed = summaries.every((summary) => confirmed[summary.pallet.id] ?? summary.pallet.completionStatus === 'completed')
  const finalConfirmed = finalSnapshot === snapshot && allPalletsConfirmed && looseConfirmed && !guard.hasDraftKind('pallet') && !guard.hasDraftKind('box')
  async function confirmLoose() {
    if (looseTotals.cbm == null || looseTotals.weightKg == null) { toast.error('낱박스 CBM과 무게를 2단계에서 입력해주세요.'); return false }
    const result = await saveChinaOutboundBoxCompletionStatusesAction({ shipmentId, updates: unassignedBoxes.map((box) => ({ boxId: box.id, status: 'completed' })) })
    if (!result.ok) { toast.error(result.error); return false }
    setSavedLooseSignature(looseSignature); router.refresh(); return true
  }
  function confirmFinal() {
    if (guard.hasDraftKind('pallet') || guard.hasDraftKind('box')) { toast.error('변경한 규격을 먼저 저장해주세요.'); return }
    if (!allPalletsConfirmed || !looseConfirmed) { toast.error('파렛트와 낱박스를 먼저 확정해주세요.'); return }
    if (totals.cbm == null || totals.weightKg == null) { toast.error('CBM과 무게의 미입력 값을 확인해주세요.'); return }
    setFinalSnapshot(snapshot)
  }
  return <section className="space-y-5" aria-label="사용 파렛트">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">사용 파렛트</h3><div className="flex flex-wrap items-center gap-3 text-sm"><span>{totals.palletCount} PLT + {totals.looseBoxCount} BOX, {totals.palletCount + totals.looseBoxCount} CTN</span>{assignmentEditor && <button type="button" disabled={isPending || guard.busy} onClick={() => dialog.current?.showModal()} className="rounded-md border px-3 py-1">파렛트 배정 수정</button>}</div></div>
    {summaries.map((summary) => <article key={summary.pallet.id} className={`overflow-hidden rounded-xl border-2 shadow-sm ${(confirmed[summary.pallet.id] ?? summary.pallet.completionStatus === 'completed') ? 'border-amber-300 bg-amber-50' : expanded.has(summary.pallet.id) ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
      <div className={`overflow-x-auto border-l-4 border-blue-600 ${(confirmed[summary.pallet.id] ?? summary.pallet.completionStatus === 'completed') ? 'bg-amber-50' : expanded.has(summary.pallet.id) ? 'bg-blue-50' : 'bg-slate-50'}`}><div className={`flex items-center gap-x-5 gap-y-3 p-4 ${'flex-wrap'}`}>
        <div className="min-w-40 shrink-0 space-y-2">
          <button type="button" aria-expanded={expanded.has(summary.pallet.id)} onClick={() => toggle(summary.pallet.id, setExpanded)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-base font-bold text-white"><Layers3 aria-hidden="true" className="size-4" />파렛트 <span data-no-translate>{summary.palletNo}</span><ChevronDown className={expanded.has(summary.pallet.id) ? "size-4 rotate-180" : "size-4"} /></button><p className="whitespace-nowrap text-xs font-medium text-slate-600">박스 {summary.boxes.length}개 · 상품 {summary.quantity.toLocaleString('ko-KR')}개</p>
        </div>
        <PalletFinalMeasurements key={`${summary.pallet.id}:${summary.pallet.manualCbm}:${summary.pallet.tareWeightKg}:${summary.pallet.lengthCm}:${summary.pallet.widthCm}:${summary.pallet.heightCm}:${summary.pallet.completionStatus}:${summary.cbm}`} shipmentId={shipmentId} summary={summary} onSaved={(pallet) => { const source = serverSummaries.find((entry) => entry.pallet.id === pallet.id); if (source) setPalletSaves((current) => ({ ...current, [pallet.id]: { source: JSON.stringify(source), pallet } })) }} onConfirmationChange={(value) => setConfirmed((current) => ({ ...current, [summary.pallet.id]: value }))} editable={dimensionsEditable} isPending={isPending} />
      </div></div>
      {expanded.has(summary.pallet.id) && <div id={`pallet-contents-${summary.pallet.id}`}>{boxList(summary.boxes)}</div>}
    </article>)}
    {!!unassignedBoxes.length && <article aria-label="낱박스 적재" className={`overflow-hidden rounded-xl border-2 ${looseConfirmed ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-background'}`}>
      <div className={`border-l-4 p-4 ${looseConfirmed ? 'border-amber-500 bg-amber-50' : 'border-transparent bg-background'}`}><div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-40 shrink-0 space-y-2"><button type="button" aria-expanded={looseOpen} onClick={() => setLooseOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-base font-bold text-amber-950"><Package aria-hidden="true" className="size-4" />낱박스<ChevronDown className={looseOpen ? 'size-4 rotate-180' : 'size-4'} /></button><p className="whitespace-nowrap text-xs font-medium text-slate-600">박스 {unassignedBoxes.length}개</p></div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-4"><div className="space-y-2 text-xs"><p>적재 CBM: <strong>{formatChinaOutboundCbm(looseTotals.cbm) ?? '미입력'} CBM</strong></p><p>규격·무게 수정은 2단계에서 가능합니다.</p><button type="button" disabled={!dimensionsEditable || isPending || savingLoose || guard.busy} onClick={() => { if (looseConfirmed) { guard.requestNavigation(() => router.push(`/purchasing/china-shipments?shipment=${encodeURIComponent(shipmentId)}&step=boxes`)); return } startLoose(async () => { await guard.runTask(confirmLoose) }) }} className="h-7 rounded border px-2 disabled:opacity-40">{looseConfirmed ? '수정하기' : '낱박스 확정하기'}</button></div>
          <div className="ml-auto whitespace-nowrap rounded border bg-white px-3 py-2 text-right text-xs tabular-nums"><p className="font-semibold">최종 CBM: {formatChinaOutboundCbm(looseTotals.cbm) ?? '미입력'} CBM</p><p className="font-semibold">최종 무게: {looseTotals.weightKg == null ? '무게 미입력' : `${looseTotals.weightKg.toLocaleString('ko-KR')} kg`}</p><p>박스 {unassignedBoxes.length}개</p>{looseConfirmed && <p className="font-semibold text-amber-800">최종 확정</p>}</div></div>
      </div></div>{looseOpen && boxList(unassignedBoxes)}
    </article>}
    <div className={`space-y-3 rounded-lg border p-4 ${finalConfirmed ? 'border-amber-300 bg-amber-50' : 'bg-muted/30'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">최종 출고 합계</p><button type="button" disabled={isPending || guard.busy || savingLoose || totals.totalBoxCount === 0} onClick={confirmFinal} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{finalConfirmed ? '확정됨 · 다시 확인' : '최종 적재 확정'}</button></div>
      {finalConfirmed && <><div className="flex flex-wrap gap-x-6 gap-y-2 text-sm tabular-nums"><span>{totals.palletCount} PLT + {totals.looseBoxCount} BOX, {totals.palletCount + totals.looseBoxCount} CTN</span><span>최종 CBM <strong>{formatChinaOutboundCbm(totals.cbm)}</strong></span><span>최종 무게 <strong>{totals.weightKg?.toLocaleString('ko-KR')} kg</strong></span></div><a href={`/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/export`} className="inline-flex rounded-md border bg-white px-3 py-2 text-sm">최종 합계·적재리스트 엑셀 다운로드</a></>}
    </div>
    {assignmentEditor && <dialog ref={dialog} data-purchasing-translate aria-label="파렛트 배정 수정" onCancel={(event) => { if (isPending || guard.busy) event.preventDefault() }} className="m-auto max-h-[90dvh] w-[min(72rem,96vw)] overflow-auto rounded-xl border bg-background p-4 text-foreground backdrop:bg-black/40"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">파렛트 배정 수정</h3><button type="button" disabled={isPending || guard.busy} onClick={() => dialog.current?.close()} className="rounded border px-3 py-1">닫기</button></div>{assignmentEditor}</dialog>}
  </section>
}
