'use client'

import { useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundCbm, formatChinaOutboundBoxDimensions } from '@/lib/purchasing/china-outbound-dimensions'
import { saveChinaOutboundPalletDimensionsAction } from '../saas-china-actions'
import { PackageWeightEditor } from './outbound-package-editors'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import type { ChinaShipmentDetailView, PalletSummary } from './china-shipments-board'

export function PalletContentsPanel({ shipmentId, summaries, boxItems, items, editable, isPending, assignmentEditor, unassignedBoxes = [] }: {
  shipmentId: string; summaries: PalletSummary[]; boxItems: ChinaShipmentDetailView['boxItems']; items: ChinaShipmentDetailView['items']
  editable: boolean; isPending: boolean; assignmentEditor?: ReactNode; unassignedBoxes?: ChinaShipmentDetailView['boxes']
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const guard = useChinaWorkGuard()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedBoxes, setExpandedBoxes] = useState<Set<string>>(new Set())
  const itemById = new Map(items.map((item) => [item.id, item]))
  function toggle(id: string, setter: typeof setExpanded) {
    setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function boxList(boxes: ChinaShipmentDetailView['boxes']) {
    return <div className="space-y-2 border-t p-3">{boxes.map((box) => {
      const allocations = boxItems.filter((allocation) => allocation.boxId === box.id)
      return <div key={box.id} className="rounded-md border">
        <button type="button" aria-expanded={expandedBoxes.has(box.id)} aria-label={`${box.boxNo} 박스 상품 ${expandedBoxes.has(box.id) ? '접기' : '펼치기'}`} onClick={() => toggle(box.id, setExpandedBoxes)} className="flex w-full items-center justify-between gap-3 p-3 text-left text-sm"><span><span data-no-translate>{box.boxNo}</span> · {allocations.reduce((sum, row) => sum + row.quantity, 0)}개</span><span className="text-xs">{formatChinaOutboundCbm(calculateChinaOutboundBoxCbm(box)) ?? '미입력'} CBM · {expandedBoxes.has(box.id) ? '접기' : '펼치기'}</span></button>
        {expandedBoxes.has(box.id) && <><PackageWeightEditor key={`${box.id}:${box.grossWeightKg}`} shipmentId={shipmentId} kind="box" packageId={box.id} packageNo={box.boxNo} initialWeight={box.grossWeightKg} editable={editable} isPending={isPending} /><ul className="space-y-2 border-t px-3 py-3 text-sm">{allocations.map((allocation) => {
          const item = itemById.get(allocation.shipmentItemId)
          return item && <li key={allocation.id} className="flex justify-between gap-3"><span><span data-no-translate>{item.sku} · {item.productName}{item.optionName ? ` · ${item.optionName}` : ''}{item.chineseProductName ? ` / ${item.chineseProductName}` : ''}</span>{item.itemCategory === '샘플' && <span className="ml-2 rounded bg-amber-50 px-2 text-xs">샘플</span>}</span><span>{allocation.quantity}개</span></li>
        })}</ul></>}
      </div>
    })}</div>
  }
  const finalCbms = summaries.map((summary) => calculateChinaOutboundBoxCbm(summary.pallet))
  return <section className="space-y-3" aria-label="사용 파렛트">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">사용 파렛트</h3><div className="flex gap-2 text-sm"><span>{summaries.length} PLT + {unassignedBoxes.length} BOX</span>{assignmentEditor && <button type="button" disabled={isPending || guard.busy} onClick={() => dialog.current?.showModal()} className="rounded-md border px-3 py-1">파렛트 배정 수정</button>}</div></div>
    {summaries.map((summary) => <article key={summary.pallet.id} className="overflow-hidden rounded-lg border bg-background">
      <button type="button" aria-expanded={expanded.has(summary.pallet.id)} aria-label={`파렛트 ${summary.palletNo} ${expanded.has(summary.pallet.id) ? '접기' : '펼치기'}`} onClick={() => toggle(summary.pallet.id, setExpanded)} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left">
        <div><p className="font-semibold">파렛트 <span data-no-translate>{summary.palletNo}</span></p><p className="mt-1 text-xs text-muted-foreground">박스 {summary.boxes.length}개 · 상품 {summary.quantity}개</p><p className="text-xs text-muted-foreground">총중량(kg): {summary.pallet.grossWeightKg ?? '미입력'}</p></div>
        <div className="text-right text-sm tabular-nums"><p>제품 적재 CBM: {formatChinaOutboundCbm(summary.cbm)} CBM</p><p className="font-semibold">최종 파렛트 CBM: {formatChinaOutboundCbm(calculateChinaOutboundBoxCbm(summary.pallet)) ?? '미입력'} CBM</p></div><span className="text-xs">{expanded.has(summary.pallet.id) ? '접기' : '펼치기'}</span>
      </button>
      {summary.boxesWithoutDimensions > 0 && <p className="px-4 pb-3 text-xs text-amber-700">규격 미입력 박스 {summary.boxesWithoutDimensions}개는 제품 적재 CBM에서 제외됩니다.</p>}
      {expanded.has(summary.pallet.id) && <>
        <PalletMeasurements key={`${summary.pallet.id}:${summary.pallet.lengthCm}:${summary.pallet.widthCm}:${summary.pallet.heightCm}`} shipmentId={shipmentId} pallet={summary.pallet} editable={editable} isPending={isPending} />
        <PackageWeightEditor key={`${summary.pallet.id}:${summary.pallet.grossWeightKg}`} shipmentId={shipmentId} kind="pallet" packageId={summary.pallet.id} packageNo={summary.palletNo} initialWeight={summary.pallet.grossWeightKg} editable={editable} isPending={isPending} />
        {boxList(summary.boxes)}
      </>}
    </article>)}
    {!!unassignedBoxes.length && <details className="rounded-lg border"><summary className="cursor-pointer p-3 text-sm">낱박스 {unassignedBoxes.length}개</summary>{boxList(unassignedBoxes)}</details>}
    {!!summaries.length && <div className="rounded-lg bg-muted/30 p-3 text-sm"><p>제품 적재 CBM 합계: {formatChinaOutboundCbm(summaries.reduce((sum, row) => sum + row.cbm, 0))} CBM</p><p className="font-semibold">최종 파렛트 CBM 합계: {finalCbms.some((value) => value == null) ? '미입력' : `${formatChinaOutboundCbm(finalCbms.reduce<number>((sum, value) => sum + (value ?? 0), 0))} CBM`}</p></div>}
    {assignmentEditor && <dialog ref={dialog} data-purchasing-translate aria-label="파렛트 배정 수정" onCancel={(event) => { if (isPending || guard.busy) event.preventDefault() }} className="m-auto max-h-[90dvh] w-[min(72rem,96vw)] overflow-auto rounded-xl border bg-background p-4 text-foreground backdrop:bg-black/40"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">파렛트 배정 수정</h3><button type="button" disabled={isPending || guard.busy} onClick={() => dialog.current?.close()} className="rounded border px-3 py-1">닫기</button></div>{assignmentEditor}</dialog>}
  </section>
}

function PalletMeasurements({ shipmentId, pallet, editable, isPending }: { shipmentId: string; pallet: PalletSummary['pallet']; editable: boolean; isPending: boolean }) {
  const router = useRouter()
  const guard = useChinaWorkGuard()
  const [pending, start] = useTransition()
  const initial = { lengthCm: String(pallet.lengthCm ?? ''), widthCm: String(pallet.widthCm ?? ''), heightCm: String(pallet.heightCm ?? '') }
  const [baseline, setBaseline] = useState(initial)
  const draftId = `pallet-dimensions:${pallet.id}`
  const [dimensions, setDimensions] = useState(() => (guard.getDraft(draftId)?.snapshot as typeof initial | undefined) ?? initial)
  const dirty = Object.keys(dimensions).some((key) => dimensions[key as keyof typeof initial] !== baseline[key as keyof typeof initial])
  async function save() {
    if (Object.values(dimensions).some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)) { toast.error('파렛트 가로·세로·높이를 모두 입력해주세요.'); return false }
    const result = await saveChinaOutboundPalletDimensionsAction({ shipmentId, palletId: pallet.id, ...Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, Number(value)])) })
    if (!result.ok) { toast.error(result.error); return false }
    setBaseline({ ...dimensions }); guard.setDraft(draftId, null); router.refresh(); toast.success('파렛트 실측 규격을 저장했습니다.'); return true
  }
  useChinaWorkDraft(draftId, dirty ? { kind: 'pallet', label: `파렛트 ${pallet.palletNo} 실측 규격`, snapshot: dimensions, save, discard: () => setDimensions({ ...baseline }) } : null)
  if (!editable) return <p className="border-t px-4 py-3 text-sm">파렛트 실측 규격: {formatChinaOutboundBoxDimensions(pallet) ?? '미입력'}</p>
  return <div className="flex flex-wrap items-end gap-3 border-t p-3"><p className="w-full text-xs text-muted-foreground">파렛트 포함 실측 크기 (cm)</p>{([['lengthCm', '가로(cm)'], ['widthCm', '세로(cm)'], ['heightCm', '높이(cm)']] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<input aria-label={`파렛트 ${pallet.palletNo} ${label}`} type="number" min="0.01" max="9999999.99" step="0.01" value={dimensions[key]} disabled={isPending || pending || guard.busy} onChange={(event) => setDimensions((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 block h-8 w-28 rounded-md border bg-background px-2 text-sm" /></label>)}<p className="py-2 text-sm">최종 파렛트 CBM: {formatChinaOutboundCbm(calculateChinaOutboundBoxCbm(dimensions)) ?? '미입력'} CBM</p><button type="button" aria-label={`파렛트 ${pallet.palletNo} 규격 저장`} disabled={isPending || pending || guard.busy || !dirty} onClick={() => start(async () => { await guard.runTask(save) })} className="h-8 rounded-md border px-3 text-sm">규격 저장</button></div>
}
