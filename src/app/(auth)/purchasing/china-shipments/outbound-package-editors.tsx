'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { largestChinaOutboundBox } from '@/lib/purchasing/china-outbound-packaging'
import { formatChinaOutboundBoxDimensions } from '@/lib/purchasing/china-outbound-dimensions'
import { mergeChinaOutboundBoxesAction, saveChinaOutboundItemChineseNameAction, saveChinaOutboundPackageWeightAction } from '../saas-china-actions'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import type { ChinaShipmentDetailView } from './china-shipments-board'

export function PackageWeightEditor({ shipmentId, packageId, packageNo, kind, initialWeight, editable, isPending }: {
  shipmentId: string; packageId: string; packageNo: string; kind: 'box' | 'pallet'; initialWeight?: number | null; editable: boolean; isPending: boolean
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
  if (!editable) return <p className="px-3 py-2 text-sm">총중량(kg): {initialWeight ?? '미입력'}</p>
  return <div className="flex items-end gap-2 px-3 py-2"><label className="text-xs">총중량(kg)<input aria-label={`${kind === 'box' ? '박스' : '파렛트'} ${packageNo} 총중량(kg)`} value={weight} onChange={(event) => setWeight(event.target.value)} disabled={isPending || pending || guard.busy} type="number" min="0.001" step="0.001" className="mt-1 block h-8 w-32 rounded-md border bg-background px-2" /></label><button type="button" disabled={isPending || pending || guard.busy || weight === baseline} onClick={() => start(async () => { await guard.runTask(save) })} className="h-8 rounded-md border px-3 text-xs">중량 저장</button></div>
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
  return <div className="space-y-1">{editing ? <><input data-no-translate maxLength={1000} aria-label={`${item.sku} 中文品名`} value={name} onChange={(event) => setName(event.target.value)} className="h-8 w-full rounded border px-2 text-sm" disabled={isPending || pending || guard.busy} /><button type="button" disabled={!name.trim() || isPending || pending || guard.busy} onClick={() => start(async () => { await guard.runTask(save) })} className="rounded border px-2 py-1 text-xs">저장</button></> : <><p data-no-translate>{item.chineseProductName || baseline || '—'}</p>{editable && <button type="button" onClick={() => setEditing(true)} disabled={isPending || guard.busy} className="text-xs underline">중국어 상품명 수정</button>}</>}</div>
}

export function MergeBoxesButton({ shipmentId, boxes, isPending }: { shipmentId: string; boxes: ChinaShipmentDetailView['boxes']; isPending: boolean }) {
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
  return <><button type="button" disabled={isPending || guard.busy || boxes.length < 2} onClick={() => dialog.current?.showModal()} className="h-8 rounded-md border px-3 text-sm">박스 합치기</button><dialog ref={dialog} data-purchasing-translate aria-label="박스 합치기" onCancel={(event) => { if (pending || guard.busy) event.preventDefault() }} className="m-auto max-h-[85dvh] w-[min(36rem,95vw)] space-y-3 overflow-auto rounded-xl border bg-background p-4 text-foreground backdrop:bg-black/40"><div className="flex justify-between"><h3 className="font-semibold">박스 합치기</h3><button type="button" disabled={pending || guard.busy} onClick={() => dialog.current?.close()}>닫기</button></div>{boxes.map((box) => <label key={box.id} className="flex items-center gap-2 rounded border p-2 text-sm"><input type="checkbox" aria-label={`${box.boxNo} 합치기 선택`} checked={selected.includes(box.id)} disabled={pending || guard.busy || box.status === 'sealed'} onChange={(event) => setSelected((current) => event.target.checked ? [...current, box.id] : current.filter((id) => id !== box.id))} /><span data-no-translate>{box.boxNo}</span><span>{formatChinaOutboundBoxDimensions(box) ?? '미입력'}</span></label>)}{target && <p className="text-sm">적용 박스: <span data-no-translate>{target.boxNo}</span> · {formatChinaOutboundBoxDimensions(target) ?? '미입력'}</p>}<button type="button" disabled={selected.length < 2 || pending || isPending || guard.busy} onClick={() => start(async () => { await guard.runTask(merge) })} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">선택 박스 합치기</button></dialog></>
}
