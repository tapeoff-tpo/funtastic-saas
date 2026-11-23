'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { calculateChinaOutboundPalletWeight, palletTareWeightKg } from '@/lib/purchasing/china-outbound-pallet-weight'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundCbm, dimensionNumber } from '@/lib/purchasing/china-outbound-dimensions'
import { saveChinaOutboundPalletDimensionsAction } from '../saas-china-actions'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import type { PalletSummary } from './china-shipments-board'

export function PalletFinalMeasurements({ shipmentId, summary, editable, isPending, onConfirmationChange }: { shipmentId: string; summary: PalletSummary; editable: boolean; isPending: boolean; onConfirmationChange?: (confirmed: boolean) => void }) {
  const guard = useChinaWorkGuard(), router = useRouter()
  const [pending, start] = useTransition()
  const measured = calculateChinaOutboundBoxCbm(summary.pallet)
  const dimensions = { lengthCm: String(summary.pallet.lengthCm ?? ''), widthCm: String(summary.pallet.widthCm ?? ''), heightCm: String(summary.pallet.heightCm ?? '') }
  const dimensionCbm = calculateChinaOutboundBoxCbm(dimensions)
  const initial = { ...dimensions, loaded: dimensionCbm === null, cbm: String(measured ?? summary.cbm), volume: measured !== null && Math.abs(measured - (dimensionCbm ?? summary.cbm) - 0.3) < 0.000001,
    weight: summary.pallet.tareWeightKg != null && palletTareWeightKg(summary.pallet.tareWeightKg) === 5 }
  const [baseline, setBaseline] = useState(initial)
  const [state, setState] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [confirmed, setConfirmed] = useState(summary.pallet.completionStatus === 'completed')
  function changed() { setConfirmed(false); onConfirmationChange?.(false) }
  function patch(values: Partial<typeof state>) {
    changed()
    setState((current) => {
      const next = { ...current, ...values }
      const base = next.loaded ? summary.cbm : calculateChinaOutboundBoxCbm({ lengthCm: next.lengthCm, widthCm: next.widthCm, heightCm: next.heightCm })
      return { ...next, cbm: base == null ? '' : String(Math.round((base + (next.volume ? 0.3 : 0)) * 1000000) / 1000000) }
    })
  }
  const dirty = JSON.stringify(state) !== JSON.stringify(baseline)
  const draftId = `pallet-final:${summary.pallet.id}`
  const weight = calculateChinaOutboundPalletWeight(summary.boxes, saved.weight ? 5 : 0)
  const disabled = !editable || isPending || pending || guard.busy
  async function save() {
    if (state.loaded && summary.boxesWithoutDimensions > 0) { toast.error('미입력 박스까지 포함하도록 파렛트 전체 가로·세로·높이를 입력해주세요.'); return false }
    if (!state.loaded && [state.lengthCm, state.widthCm, state.heightCm].some((value) => dimensionNumber(value) === null || Number(value) > 9999999.99)) { toast.error('가로·세로·높이를 모두 입력해주세요.'); return false }
    const cbm = Number(state.cbm)
    if (!state.cbm.trim() || !Number.isFinite(cbm) || cbm < 0.000001 || cbm > 999999999) { toast.error('최종 CBM을 확인해주세요.'); return false }
    const result = await saveChinaOutboundPalletDimensionsAction({ shipmentId, palletId: summary.pallet.id, lengthCm: state.loaded ? null : Number(state.lengthCm), widthCm: state.loaded ? null : Number(state.widthCm), heightCm: state.loaded ? null : Number(state.heightCm), manualCbm: cbm, tareWeightKg: state.weight ? 5 : 0, finalize: true })
    if (!result.ok) { toast.error(result.error); return false }
    setConfirmed(true); onConfirmationChange?.(true); setBaseline({ ...state }); setSaved({ ...state }); guard.setDraft(draftId, null); router.refresh(); return true
  }
  useChinaWorkDraft(draftId, dirty ? { kind: 'pallet', label: `파렛트 ${summary.palletNo} 최종 규격`, snapshot: state, save, discard: () => setState({ ...baseline }) } : null)
  return <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-4">
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label="적재 CBM 사용" checked={state.loaded} disabled={disabled} onChange={(event) => patch({ loaded: event.target.checked })} />적재 CBM 사용: <strong>{formatChinaOutboundCbm(summary.cbm)} CBM</strong><span>전체 {summary.boxes.length}박스</span></label>
      {summary.boxesWithoutDimensions > 0 && <p className="text-xs text-amber-800">규격 없는 {summary.boxesWithoutDimensions}박스도 포함하려면 파렛트 전체 규격으로 확정해주세요.</p>}
      <div className="flex items-center gap-2 text-xs"><span>파렛트 전체 규격</span>{(['lengthCm', 'widthCm', 'heightCm'] as const).map((field, index) => <label key={field} className="flex items-center gap-1">{['가로', '세로', '높이'][index]}<input aria-label={`파렛트 ${summary.palletNo} ${['가로', '세로', '높이'][index]}`} type="number" min="0.01" step="0.01" value={state[field]} disabled={disabled} onChange={(event) => patch({ loaded: false, [field]: event.target.value })} className="h-7 w-20 rounded border border-blue-200 bg-blue-50 px-2" /></label>)}<span>cm</span></div>
      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" disabled={disabled} checked={state.volume} onChange={(event) => {
          patch({ volume: event.target.checked })
        }} />파렛트 부피 0.3CBM 포함</label>
        <label className="flex items-center gap-1"><input type="checkbox" disabled={disabled} checked={state.weight} onChange={(event) => { changed(); setState((current) => ({ ...current, weight: event.target.checked })) }} />파렛트 무게 5kg 포함</label>
      </div>
      <div className="flex items-center gap-2 text-xs"><label>최종 CBM <input aria-label={`파렛트 ${summary.palletNo} 최종 CBM`} type="number" step="0.000001" value={state.cbm} readOnly className="h-7 w-28 rounded border bg-muted/30 px-2" /></label>
        <button type="button" disabled={disabled} onClick={() => start(async () => { await guard.runTask(save) })} className="h-7 rounded border px-2 disabled:opacity-40">{confirmed && !dirty ? '확정됨 · 다시 저장' : '최종 저장하기'}</button>
      </div>
    </div>
    <div className="ml-auto whitespace-nowrap rounded border bg-white px-3 py-2 text-right text-xs tabular-nums">
      <p className="font-semibold">최종 CBM: {formatChinaOutboundCbm(Number(saved.cbm))} CBM</p>
      <p className="font-semibold">최종 무게: {weight.grossWeightKg == null ? '무게 미입력' : `${weight.grossWeightKg.toLocaleString('ko-KR')} kg`}</p>
      <p>박스 {summary.boxes.length}개 · 상품 {summary.quantity.toLocaleString('ko-KR')}개</p>
      {confirmed && !dirty && <p className="font-semibold text-amber-800">최종 확정 · 수정 가능</p>}
      {dirty && <p className="text-blue-700">변경사항 저장 전</p>}
    </div>
  </div>
}
