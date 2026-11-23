'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { largestChinaOutboundBox } from '@/lib/purchasing/china-outbound-packaging'
import { fillChinaOutboundDimensionInputs, calculateChinaOutboundBoxCbm, formatChinaOutboundBoxDimensions, formatChinaOutboundCbm } from '@/lib/purchasing/china-outbound-dimensions'
import { mergeChinaOutboundBoxesAction, saveChinaOutboundBoxDimensionsAction, saveChinaOutboundItemChineseNameAction, saveChinaOutboundPackageWeightAction } from '../saas-china-actions'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import type { ChinaShipmentDetailView } from './china-shipments-board'

export function BoxDimensionsEditor({ shipmentId, box, editable, isPending, automaticCbm = false }: {
  shipmentId: string; box: ChinaShipmentDetailView['boxes'][number]; editable: boolean; isPending: boolean; automaticCbm?: boolean
}) {
  const guard = useChinaWorkGuard()
  const router = useRouter()
  const [pending, start] = useTransition()
  const initial = { lengthCm: String(box.lengthCm ?? ''), widthCm: String(box.widthCm ?? ''), heightCm: String(box.heightCm ?? ''), manualCbm: String(box.manualCbm ?? '') }
  const [baseline, setBaseline] = useState(initial)
  const draftId = `box-dimensions:${box.id}`
  const [dimensions, setDimensions] = useState(() => ({ ...initial, ...(guard.getDraft(draftId)?.snapshot as Partial<typeof initial> | undefined) }))
  const dirty = (Object.keys(dimensions) as Array<keyof typeof initial>).some((key) => dimensions[key] !== baseline[key])
  async function save() {
    const prepared = automaticCbm ? { ...dimensions, manualCbm: "" } : fillChinaOutboundDimensionInputs(dimensions)
    const values = [prepared.lengthCm, prepared.widthCm, prepared.heightCm]
    const empty = values.every((value) => !value.trim())
    if (!empty && values.some((value) => !value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 9_999_999.99)) {
      toast.error('박스 가로·세로·높이를 모두 입력하거나 모두 비워주세요.')
      return false
    }
    if (dimensions.manualCbm.trim() && (!Number.isFinite(Number(dimensions.manualCbm)) || Number(dimensions.manualCbm) < 0.000001 || Number(dimensions.manualCbm) > 999_999_999)) {
      toast.error('CBM은 0.000001 이상, 999,999,999 이하인 숫자로 입력해주세요.')
      return false
    }
    setDimensions(prepared)
    const result = await saveChinaOutboundBoxDimensionsAction({
      shipmentId, boxId: box.id,
      lengthCm: empty ? null : Number(prepared.lengthCm),
      widthCm: empty ? null : Number(prepared.widthCm),
      heightCm: empty ? null : Number(prepared.heightCm),
      ...(automaticCbm ? { manualCbm: null } : dimensions.manualCbm !== baseline.manualCbm ? { manualCbm: dimensions.manualCbm.trim() ? Number(dimensions.manualCbm) : null } : {}),
    })
    if (!result.ok) { toast.error(result.error); return false }
    setBaseline({ ...prepared }); guard.setDraft(draftId, null); router.refresh(); toast.success('박스 규격을 저장했습니다.'); return true
  }
  useChinaWorkDraft(draftId, dirty ? { kind: 'box', label: `박스 ${box.boxNo} 규격`, snapshot: dimensions, save, discard: () => setDimensions({ ...baseline }) } : null)
  return <div className="space-y-2">
    {editable ? <div className="flex flex-wrap items-end gap-2">{([['lengthCm', '가로(cm)'], ['widthCm', '세로(cm)'], ['heightCm', '높이(cm)']] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<input aria-label={`박스 ${box.boxNo} ${label}`} type="number" min="0.01" max="9999999.99" step="0.01" value={dimensions[key]} disabled={isPending || pending || guard.busy} onChange={(event) => setDimensions((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 block h-8 w-20 rounded-md border bg-background px-2" /></label>)}{!automaticCbm && <label className="text-xs">CBM(직접 입력)<input aria-label={`박스 ${box.boxNo} CBM(직접 입력)`} type="number" min="0.000001" max="999999999" step="0.000001" value={dimensions.manualCbm} placeholder={formatChinaOutboundCbm(calculateChinaOutboundBoxCbm({ ...dimensions, manualCbm: null })) ?? '자동 계산'} disabled={isPending || pending || guard.busy} onChange={(event) => setDimensions((current) => ({ ...current, manualCbm: event.target.value }))} onBlur={() => setDimensions(fillChinaOutboundDimensionInputs)} className="mt-1 block h-8 w-28 rounded-md border bg-background px-2" /></label>}<button type="button" aria-label={`박스 ${box.boxNo} 규격 저장`} disabled={isPending || pending || guard.busy || !dirty} onClick={() => start(async () => { await guard.runTask(save) })} className="h-8 rounded-md border px-3 text-xs">규격 저장</button></div>
      : <p className="text-xs">{formatChinaOutboundBoxDimensions(box) ?? '미입력'}</p>}
    <p className="text-xs tabular-nums text-muted-foreground">CBM: {formatChinaOutboundCbm(calculateChinaOutboundBoxCbm(editable ? { ...dimensions, manualCbm: automaticCbm ? null : dimensions.manualCbm } : box)) ?? '미입력'}</p>
    {editable && !automaticCbm && <p className="text-xs text-muted-foreground">CBM 입력 시 빈 치수는 같은 부피의 추정 치수로 채웁니다. CBM을 비우면 치수로 자동 계산합니다.</p>}
  </div>
}

export function PackageWeightEditor({ shipmentId, packageId, packageNo, kind, initialWeight, editable, isPending, compact = false }: {
  shipmentId: string; packageId: string; packageNo: string; kind: 'box' | 'pallet'; initialWeight?: number | null; editable: boolean; isPending: boolean; compact?: boolean
}) {
  const guard = useChinaWorkGuard()
  const router = useRouter()
  const [pending, start] = useTransition()
  const draftId = `weight:${kind}:${packageId}`
  const [baseline, setBaseline] = useState(String(initialWeight ?? ''))
  const [weight, setWeight] = useState(() => (guard.getDraft(draftId)?.snapshot as string | undefined) ?? baseline)
  async function save() {
    if (!Number.isFinite(Number(weight)) || Number(weight) <= 0) { toast.error('총중량은 0보다 큰 숫자로 입력해주세요.'); return false }
    const result = await saveChinaOutboundPackageWeightAction({ shipmentId, packageId, kind, grossWeightKg: Number(weight) })
    if (!result.ok) { toast.error(result.error); return false }
    setBaseline(weight); guard.setDraft(draftId, null); router.refresh(); toast.success('총중량을 저장했습니다.'); return true
  }
  useChinaWorkDraft(draftId, weight !== baseline ? { kind: kind === 'box' ? 'box' : 'pallet', label: '총중량(kg)', snapshot: weight, save, discard: () => setWeight(baseline) } : null)
  if (!editable) return <p className={`${compact ? '' : 'px-3 py-2'} text-sm`}>총중량(kg): {initialWeight ?? '미입력'}</p>
  return <div className={`flex items-end gap-2 ${compact ? '' : 'px-3 py-2'}`}><label className="text-xs">총중량(kg)<input aria-label={`${kind === 'box' ? '박스' : '파렛트'} ${packageNo} 총중량(kg)`} value={weight} onChange={(event) => setWeight(event.target.value)} disabled={isPending || pending || guard.busy} type="number" min="0.001" step="0.001" className="mt-1 block h-8 w-32 rounded-md border bg-background px-2" /></label><button type="button" disabled={isPending || pending || guard.busy || weight === baseline} onClick={() => start(async () => { await guard.runTask(save) })} className="h-8 rounded-md border px-3 text-xs">중량 저장</button></div>
}

export function ChineseNameEditor({ shipmentId, item, editable, isPending }: { shipmentId: string; item: ChinaShipmentDetailView['items'][number]; editable: boolean; isPending: boolean }) {
  const guard = useChinaWorkGuard()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState(false)
  const [baseline, setBaseline] = useState(item.chineseProductName ?? '')
  const [name, setName] = useState(baseline)
  const draftId = `chinese-name:${item.id}`
  async function save() {
    const result = await saveChinaOutboundItemChineseNameAction({ shipmentId, shipmentItemId: item.id, chineseProductName: name.trim() })
    if (!result.ok) { toast.error(result.error); return false }
    setBaseline(name); setEditing(false); guard.setDraft(draftId, null); router.refresh(); return true
  }
  useChinaWorkDraft(draftId, name !== baseline ? { kind: 'items', label: '중국어 상품명', snapshot: name, save, discard: () => { setName(baseline); setEditing(false) } } : null)
  const disabled = !editable || isPending || pending || guard.busy
  function cancel() { setName(baseline); setEditing(false); guard.setDraft(draftId, null) }
  function submit() {
    if (disabled || !name.trim()) return
    start(async () => { await guard.runTask(save) })
  }
  return <div className="min-w-36 space-y-1">{editing ? <>
    <input data-no-translate autoFocus maxLength={1000} aria-label={`${item.sku} 中文品名`} value={name}
      onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') { event.preventDefault(); submit() }
        if (event.key === 'Escape' && !disabled) { event.preventDefault(); cancel() }
      }} className="h-8 w-full rounded border bg-background px-2 text-sm" disabled={disabled} />
    <div className="flex gap-2"><button type="button" disabled={!name.trim() || disabled} onClick={submit} className="rounded border px-2 py-1 text-xs">저장</button>
      <button type="button" disabled={disabled} onClick={cancel} className="rounded border px-2 py-1 text-xs">취소</button></div>
  </> : editable ? <div data-no-translate role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
    aria-label={`${item.sku} 중국어 상품명 편집`} title="더블클릭하여 수정 · Enter로 편집"
    onDoubleClick={() => { if (!disabled) setEditing(true) }} onKeyDown={(event) => {
      if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setEditing(true) }
    }} className="min-h-8 cursor-text rounded border border-transparent px-2 py-1 hover:border-input hover:bg-muted/30 focus-visible:outline-2">
    {baseline || '—'}
  </div> : <p data-no-translate className="px-2 py-1">{baseline || '—'}</p>}</div>

}

export function MergeBoxesButton({ shipmentId, boxes, productsByBox, isPending }: { shipmentId: string; productsByBox: Map<string, string[]>; boxes: ChinaShipmentDetailView['boxes']; isPending: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const guard = useChinaWorkGuard()
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [pending, start] = useTransition()
  const selectedBoxes = boxes.filter((box) => selected.includes(box.id))
  const target = largestChinaOutboundBox(selectedBoxes)
  async function merge() {
    if (guard.hasDraftKind('box') || guard.hasDraftKind('pallet')) { toast.error('박스·파렛트 변경사항을 먼저 저장해주세요.'); return false }
    const result = await mergeChinaOutboundBoxesAction({ shipmentId, boxIds: selected })
    if (!result.ok) { toast.error(result.error); return false }
    setSelected([]); dialog.current?.close(); router.refresh(); toast.success('큰 박스 규격으로 합쳤습니다.'); return true
  }
  return <><button type="button" disabled={isPending || guard.busy || boxes.length < 2} onClick={() => dialog.current?.showModal()} className="h-8 rounded-md border px-3 text-sm">박스 합치기</button><dialog ref={dialog} data-purchasing-translate aria-label="박스 합치기" onCancel={(event) => { if (pending || guard.busy) event.preventDefault() }} className="m-auto max-h-[85dvh] w-[min(36rem,95vw)] space-y-3 overflow-auto rounded-xl border bg-background p-4 text-foreground backdrop:bg-black/40"><div className="flex justify-between"><h3 className="font-semibold">박스 합치기</h3><button type="button" disabled={pending || guard.busy} onClick={() => dialog.current?.close()}>닫기</button></div>{boxes.map((box) => <div key={box.id} className="rounded border"><label className="flex items-center gap-2 rounded border p-2 text-sm"><input type="checkbox" aria-label={`${box.boxNo} 합치기 선택`} checked={selected.includes(box.id)} disabled={pending || guard.busy || box.status === 'sealed'} onChange={(event) => setSelected((current) => event.target.checked ? [...current, box.id] : current.filter((id) => id !== box.id))} /><span data-no-translate>{box.boxNo}</span><span>{formatChinaOutboundBoxDimensions(box) ?? '미입력'}</span></label><details className="px-2 pb-2 text-xs"><summary className="cursor-pointer"><span data-no-translate>{productsByBox.get(box.id)?.[0]}</span>{(productsByBox.get(box.id)?.length ?? 0) > 1 && <span> +{(productsByBox.get(box.id)?.length ?? 1) - 1}</span>} <span>상품 확인</span></summary><ul>{productsByBox.get(box.id)?.map(name => <li key={name} data-no-translate>{name}</li>)}</ul></details></div>)}{target && <p className="text-sm">선택 박스 CBM 합계: {selectedBoxes.every(box => calculateChinaOutboundBoxCbm(box) != null) ? formatChinaOutboundCbm(selectedBoxes.reduce((sum, box) => sum + (calculateChinaOutboundBoxCbm(box) ?? 0), 0)) : "규격 미입력"} · 적용 박스: <span data-no-translate>{target.boxNo}</span> · {formatChinaOutboundBoxDimensions(target) ?? '미입력'}</p>}<button type="button" disabled={selected.length < 2 || pending || isPending || guard.busy} onClick={() => start(async () => { await guard.runTask(merge) })} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">선택 박스 합치기</button></dialog></>
}
