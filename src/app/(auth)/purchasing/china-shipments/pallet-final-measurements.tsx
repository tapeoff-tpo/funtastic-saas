'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { calculateChinaOutboundPalletWeight, palletTareWeightKg } from '@/lib/purchasing/china-outbound-pallet-weight'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundCbm } from '@/lib/purchasing/china-outbound-dimensions'
import { saveChinaOutboundPalletDimensionsAction } from '../saas-china-actions'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import type { PalletSummary } from './china-shipments-board'

export function PalletFinalMeasurements({ shipmentId, summary, editable, isPending }: { shipmentId: string; summary: PalletSummary; editable: boolean; isPending: boolean }) {
  const guard = useChinaWorkGuard(), router = useRouter()
  const [pending, start] = useTransition()
  const measured = calculateChinaOutboundBoxCbm(summary.pallet)
  const initial = { cbm: String(measured ?? summary.cbm), volume: measured !== null && Math.abs(measured - summary.cbm - 0.3) < 0.000001,
    weight: summary.pallet.tareWeightKg != null && palletTareWeightKg(summary.pallet.tareWeightKg) === 5 }
  const [baseline, setBaseline] = useState(initial)
  const [state, setState] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const dirty = state.cbm !== baseline.cbm || state.volume !== baseline.volume || state.weight !== baseline.weight
  const draftId = `pallet-final:${summary.pallet.id}`
  const weight = calculateChinaOutboundPalletWeight(summary.boxes, saved.weight ? 5 : 0)
  const disabled = !editable || isPending || pending || guard.busy
  async function save() {
    const cbm = Number(state.cbm)
    if (!state.cbm.trim() || !Number.isFinite(cbm) || cbm < 0.000001 || cbm > 999999999) { toast.error('최종 CBM을 확인해주세요.'); return false }
    const result = await saveChinaOutboundPalletDimensionsAction({ shipmentId, palletId: summary.pallet.id, manualCbm: cbm, tareWeightKg: state.weight ? 5 : 0 })
    if (!result.ok) { toast.error(result.error); return false }
    setBaseline({ ...state }); setSaved({ ...state }); guard.setDraft(draftId, null); router.refresh(); return true
  }
  useChinaWorkDraft(draftId, dirty ? { kind: 'pallet', label: `파렛트 ${summary.palletNo} 최종 규격`, snapshot: state, save, discard: () => setState({ ...baseline }) } : null)
  return <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-4">
    <div className="space-y-2">
      <p className="text-xs">적재 CBM: <strong>{formatChinaOutboundCbm(summary.cbm)} CBM</strong>{summary.boxesWithoutDimensions > 0 && <span className="ml-2 text-amber-700">규격 미입력 {summary.boxesWithoutDimensions}박스 제외</span>}</p>
      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" disabled={disabled} checked={state.volume} onChange={(event) => {
          const checked = event.target.checked
          setState((current) => ({ ...current, volume: checked, cbm: String(Math.round((Number(current.cbm || summary.cbm) + (checked ? 0.3 : -0.3)) * 1000000) / 1000000) }))
        }} />파렛트 부피 0.3CBM 포함</label>
        <label className="flex items-center gap-1"><input type="checkbox" disabled={disabled} checked={state.weight} onChange={(event) => setState((current) => ({ ...current, weight: event.target.checked }))} />파렛트 무게 5kg 포함</label>
      </div>
      <div className="flex items-center gap-2 text-xs"><label>최종 CBM 직접 수정 <input aria-label={`파렛트 ${summary.palletNo} 최종 CBM`} type="number" step="0.000001" value={state.cbm} disabled={disabled} onChange={(event) => setState((current) => ({ ...current, cbm: event.target.value }))} className="h-7 w-28 rounded border border-blue-200 bg-blue-50 px-2" /></label>
        <button type="button" disabled={disabled || !dirty} onClick={() => start(async () => { await guard.runTask(save) })} className="h-7 rounded border px-2 disabled:opacity-40">저장하기</button>
      </div>
    </div>
    <div className="ml-auto whitespace-nowrap rounded border bg-white px-3 py-2 text-right text-xs tabular-nums">
      <p className="font-semibold">최종 CBM: {formatChinaOutboundCbm(Number(saved.cbm))} CBM</p>
      <p className="font-semibold">최종 무게: {weight.grossWeightKg == null ? '무게 미입력' : `${weight.grossWeightKg.toLocaleString('ko-KR')} kg`}</p>
      <p>박스 {summary.boxes.length}개 · 상품 {summary.quantity.toLocaleString('ko-KR')}개</p>
      {dirty && <p className="text-blue-700">변경사항 저장 전</p>}
    </div>
  </div>
}
