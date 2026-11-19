'use client'

import { useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, Layers3 } from 'lucide-react'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundCbm, formatChinaOutboundBoxDimensions } from '@/lib/purchasing/china-outbound-dimensions'
import { calculateChinaOutboundPalletWeight, palletTareWeightKg } from '@/lib/purchasing/china-outbound-pallet-weight'
import { saveChinaOutboundPalletDimensionsAction, saveChinaOutboundPalletTareWeightAction } from '../saas-china-actions'
import { PackageWeightEditor } from './outbound-package-editors'
import { ContentsToggle } from './contents-toggle'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import type { ChinaShipmentDetailView, PalletSummary } from './china-shipments-board'

export function PalletContentsPanel({ shipmentId, summaries, boxItems, items, editable, isPending, assignmentEditor, unassignedBoxes = [], initiallyExpanded = false }: {
  shipmentId: string; summaries: PalletSummary[]; boxItems: ChinaShipmentDetailView['boxItems']; items: ChinaShipmentDetailView['items']
  editable: boolean; isPending: boolean; assignmentEditor?: ReactNode; unassignedBoxes?: ChinaShipmentDetailView['boxes']; initiallyExpanded?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const guard = useChinaWorkGuard()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initiallyExpanded ? summaries.map((summary) => summary.pallet.id) : []))
  const itemById = new Map(items.map((item) => [item.id, item]))
  function toggle(id: string, setter: typeof setExpanded) {
    setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function boxList(boxes: ChinaShipmentDetailView['boxes']) {
    return <div className="border-t border-blue-200 bg-slate-50/80 px-3 py-4 sm:px-5"><div className="space-y-3 border-l-2 border-blue-200 pl-3 sm:pl-4">{boxes.map((box) => {
      const allocations = boxItems.filter((allocation) => allocation.boxId === box.id)
      return <div key={box.id} role="group" aria-label={`박스 ${box.boxNo} 적재 상품·중량`} className="flex flex-wrap items-start gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm sm:px-4">
        <div className="w-36 shrink-0"><p className="inline-flex whitespace-nowrap rounded-md border border-slate-200 bg-slate-100 px-2 py-1 font-semibold text-slate-800">박스 <span data-no-translate className="ml-1">{box.boxNo}</span> · {allocations.reduce((sum, row) => sum + row.quantity, 0)}개</p><p className="mt-2 text-xs tabular-nums text-slate-500">{formatChinaOutboundCbm(calculateChinaOutboundBoxCbm(box)) ?? '미입력'} CBM</p></div>
        <ul className="min-w-48 flex-1 divide-y divide-slate-100">{allocations.map((allocation) => {
          const item = itemById.get(allocation.shipmentItemId)
          return item && <li key={allocation.id} className="flex items-start justify-between gap-3 py-1.5 first:pt-0 last:pb-0"><span className="min-w-0 break-words leading-6"><span data-no-translate>{item.sku} · {item.productName}{item.optionName ? ` · ${item.optionName}` : ''}{item.chineseProductName ? ` / ${item.chineseProductName}` : ''}</span>{item.itemCategory === '샘플' && <span className="ml-2 rounded bg-amber-50 px-2 text-xs">샘플</span>}</span><span className="shrink-0 rounded bg-blue-50 px-2 py-1 text-xs font-semibold tabular-nums text-blue-900">{allocation.quantity}개</span></li>
        })}</ul>
        <PackageWeightEditor key={`${box.id}:${box.grossWeightKg}`} shipmentId={shipmentId} kind="box" packageId={box.id} packageNo={box.boxNo} initialWeight={box.grossWeightKg} editable={editable} isPending={isPending} compact />
      </div>
    })}</div></div>
  }
  const finalCbms = summaries.map((summary) => calculateChinaOutboundBoxCbm(summary.pallet))
  return <section className="space-y-5" aria-label="사용 파렛트">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">사용 파렛트</h3><div className="flex gap-2 text-sm"><span>{summaries.length} PLT + {unassignedBoxes.length} BOX</span>{assignmentEditor && <button type="button" disabled={isPending || guard.busy} onClick={() => dialog.current?.showModal()} className="rounded-md border px-3 py-1">파렛트 배정 수정</button>}</div></div>
    {summaries.map((summary) => <article key={summary.pallet.id} className={`overflow-hidden rounded-xl border-2 shadow-sm ${expanded.has(summary.pallet.id) ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
      <div className={`overflow-x-auto border-l-4 border-blue-600 ${expanded.has(summary.pallet.id) ? 'bg-blue-50' : 'bg-slate-50'}`}><div className={`flex items-center gap-x-5 gap-y-3 p-4 ${editable ? 'min-w-max' : 'flex-wrap'}`}>
        <div className="min-w-40 shrink-0 space-y-2">
          <p className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-base font-bold text-white"><Layers3 aria-hidden="true" className="size-4" />파렛트 <span data-no-translate>{summary.palletNo}</span></p><p className="whitespace-nowrap text-xs font-medium text-slate-600">박스 {summary.boxes.length}개 · 상품 {summary.quantity.toLocaleString('ko-KR')}개</p>
        </div>
        <PalletMeasurements key={`${summary.pallet.id}:${summary.pallet.lengthCm}:${summary.pallet.widthCm}:${summary.pallet.heightCm}`} shipmentId={shipmentId} pallet={summary.pallet} editable={editable} isPending={isPending} productCbm={summary.cbm}
          renderWeight={(dimensionsEditor) => <PalletWeightMeasurements key={`${summary.pallet.id}:${summary.pallet.tareWeightKg ?? 5}`} shipmentId={shipmentId} pallet={summary.pallet} boxes={summary.boxes.filter((box) => boxItems.some((allocation) => allocation.boxId === box.id && allocation.quantity > 0))} editable={editable} isPending={isPending}
            contentsToggle={<ContentsToggle expanded={expanded.has(summary.pallet.id)} label={`파렛트 ${summary.palletNo} ${expanded.has(summary.pallet.id) ? '접기' : '펼치기'}`} controls={`pallet-contents-${summary.pallet.id}`} onClick={() => toggle(summary.pallet.id, setExpanded)} />}>{dimensionsEditor}</PalletWeightMeasurements>} />
      </div></div>
      {summary.boxesWithoutDimensions > 0 && <p className="px-4 pb-3 text-xs text-amber-700">규격 미입력 박스 {summary.boxesWithoutDimensions}개는 제품 적재 CBM에서 제외됩니다.</p>}
      {expanded.has(summary.pallet.id) && <div id={`pallet-contents-${summary.pallet.id}`}>{boxList(summary.boxes)}</div>}
    </article>)}
    {!!unassignedBoxes.length && <details open={initiallyExpanded} className="group overflow-hidden rounded-xl border-2 border-amber-200"><summary className="flex cursor-pointer list-none items-center justify-between border-l-4 border-amber-500 bg-amber-50 p-4 text-sm font-semibold text-amber-950 [&::-webkit-details-marker]:hidden">낱박스 {unassignedBoxes.length}개<ChevronDown aria-hidden="true" className="size-5 transition-transform group-open:rotate-180" /></summary>{boxList(unassignedBoxes)}</details>}
    {!!summaries.length && <div className="overflow-x-auto rounded-lg bg-muted/30 p-3 text-sm"><p className="whitespace-nowrap">제품 적재 CBM 합계: {formatChinaOutboundCbm(summaries.reduce((sum, row) => sum + row.cbm, 0))} CBM</p><p className="whitespace-nowrap font-semibold">최종 파렛트 CBM 합계: {finalCbms.some((value) => value == null) ? '미입력' : `${formatChinaOutboundCbm(finalCbms.reduce<number>((sum, value) => sum + (value ?? 0), 0))} CBM`}</p></div>}
    {assignmentEditor && <dialog ref={dialog} data-purchasing-translate aria-label="파렛트 배정 수정" onCancel={(event) => { if (isPending || guard.busy) event.preventDefault() }} className="m-auto max-h-[90dvh] w-[min(72rem,96vw)] overflow-auto rounded-xl border bg-background p-4 text-foreground backdrop:bg-black/40"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">파렛트 배정 수정</h3><button type="button" disabled={isPending || guard.busy} onClick={() => dialog.current?.close()} className="rounded border px-3 py-1">닫기</button></div>{assignmentEditor}</dialog>}
  </section>
}

function PalletWeightMeasurements({ shipmentId, pallet, boxes, editable, isPending, children, contentsToggle }: {
  shipmentId: string; pallet: PalletSummary['pallet']; boxes: ChinaShipmentDetailView['boxes']; editable: boolean; isPending: boolean; children: ReactNode; contentsToggle: ReactNode
}) {
  const guard = useChinaWorkGuard()
  const [pending, start] = useTransition()
  const draftId = `pallet-tare:${pallet.id}`
  const [baseline, setBaseline] = useState(() => String(palletTareWeightKg(pallet.tareWeightKg)))
  const [tare, setTare] = useState(() => (guard.getDraft(draftId)?.snapshot as string | undefined) ?? baseline)
  const dirty = tare !== baseline
  const validTare = tare.trim() !== '' && Number.isFinite(Number(tare)) && Number(tare) >= 0 && Number(tare) <= 999_999_999
  const measurement = calculateChinaOutboundPalletWeight(boxes, validTare ? Number(tare) : baseline)
  const grossWeight = validTare ? measurement.grossWeightKg : null
  const formatWeight = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })

  async function save() {
    if (!validTare) { toast.error('파렛트 무게는 0 이상인 숫자로 입력해주세요.'); return false }
    const result = await saveChinaOutboundPalletTareWeightAction({ shipmentId, palletId: pallet.id, tareWeightKg: Number(tare) })
    if (!result.ok) { toast.error(result.error ?? '파렛트 무게를 저장하지 못했습니다.'); return false }
    setBaseline(tare)
    guard.setDraft(draftId, null)
    toast.success('파렛트 무게를 저장했습니다.')
    return true
  }
  useChinaWorkDraft(draftId, dirty ? { kind: 'pallet', label: `파렛트 ${pallet.palletNo} 자체 무게`, snapshot: tare, save, discard: () => setTare(baseline) } : null)

  return <div className={`${editable ? 'shrink-0' : 'min-w-0 flex-1'} text-sm`}>
    <div className={`flex items-center gap-3 ${editable ? 'whitespace-nowrap' : 'flex-wrap'}`}>
      {children}
    {editable ? <>
      <label className="inline-flex shrink-0 items-center gap-1 text-xs">파렛트 무게<input aria-label={`파렛트 ${pallet.palletNo} 자체 무게(kg)`} value={tare} onChange={(event) => setTare(event.target.value)} disabled={isPending || pending || guard.busy} type="number" min="0" max="999999999" step="0.001" className="h-8 w-16 rounded-md border bg-background px-2 text-right" />kg</label>
      <button type="button" aria-label={`파렛트 ${pallet.palletNo} 무게 저장`} disabled={isPending || pending || guard.busy || !dirty} onClick={() => start(async () => { await guard.runTask(save) })} className="h-8 shrink-0 rounded-md border px-3 text-xs">파렛트 무게 저장</button>
    </> : <p className="text-xs">파렛트 무게 {formatWeight(measurement.tareWeightKg)}kg</p>}
      <p title={`박스 중량 합계 ${measurement.boxWeightKg == null ? '—' : `${formatWeight(measurement.boxWeightKg)}kg`} + 파렛트 무게 ${validTare ? `${formatWeight(measurement.tareWeightKg)}kg` : '—'}`} className="shrink-0 rounded-md border border-blue-200 bg-white px-3 py-1.5 font-bold tabular-nums text-blue-950">총중량(kg): {grossWeight == null ? '미입력' : formatWeight(grossWeight)}</p>
      {contentsToggle}
    </div>
    {measurement.missingBoxWeightCount > 0 && <p className="mt-2 text-xs text-amber-700">무게 미입력 박스 {measurement.missingBoxWeightCount}개가 있어 총중량을 계산할 수 없습니다.</p>}
  </div>
}

function PalletMeasurements({ shipmentId, pallet, editable, isPending, renderWeight, productCbm }: { shipmentId: string; pallet: PalletSummary['pallet']; editable: boolean; isPending: boolean; renderWeight: (dimensionsEditor: ReactNode) => ReactNode; productCbm: number }) {
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
  return <div className={`flex flex-1 items-center justify-between gap-4 ${editable ? 'min-w-max' : 'min-w-0 flex-wrap'}`}>
    {renderWeight(editable ? <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">{([['lengthCm', '가로(cm)'], ['widthCm', '세로(cm)'], ['heightCm', '높이(cm)']] as const).map(([key, label]) => <label key={key} className="inline-flex items-center gap-1 text-xs">{label}<input aria-label={`파렛트 ${pallet.palletNo} ${label}`} type="number" min="0.01" max="9999999.99" step="0.01" value={dimensions[key]} disabled={isPending || pending || guard.busy} onChange={(event) => setDimensions((current) => ({ ...current, [key]: event.target.value }))} className="h-8 w-16 rounded-md border bg-background px-2 text-sm" /></label>)}<button type="button" aria-label={`파렛트 ${pallet.palletNo} 규격 저장`} disabled={isPending || pending || guard.busy || !dirty} onClick={() => start(async () => { await guard.runTask(save) })} className="h-8 shrink-0 rounded-md border px-3 text-sm">규격 저장</button></div>
      : <p className="text-sm">파렛트 실측 규격: {formatChinaOutboundBoxDimensions(pallet) ?? '미입력'}</p>)}
    <div className="shrink-0 whitespace-nowrap rounded-lg border border-blue-100 bg-white px-3 py-2 text-right text-sm tabular-nums"><p className="font-semibold text-blue-950">최종 파렛트 CBM: {formatChinaOutboundCbm(calculateChinaOutboundBoxCbm(dimensions)) ?? '미입력'} CBM</p><p className="mt-1 text-xs text-slate-500">제품 적재 CBM: {formatChinaOutboundCbm(productCbm)} CBM</p></div>
  </div>
}
