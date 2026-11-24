'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundCbm } from '@/lib/purchasing/china-outbound-dimensions'
import { saveChinaOutboundBoxesMeasurementsAction } from '../saas-china-actions'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import type { SavedBoxSummary } from './china-shipments-board'

const fields = [['lengthCm', '가로(cm)'], ['widthCm', '세로(cm)'], ['heightCm', '높이(cm)'], ['grossWeightKg', '총중량(kg)']] as const
type Values = Record<typeof fields[number][0], string>
export function BoxMeasurementCells({ shipmentId, box, editable, isPending, actions }: {
  shipmentId: string; box: SavedBoxSummary['box']; editable: boolean; isPending: boolean; actions?: React.ReactNode
}) {
  const guard = useChinaWorkGuard()
  const router = useRouter()
  const [pending, start] = useTransition()
  const initial = Object.fromEntries(fields.map(([field]) => [field, String(box[field] ?? '')])) as Values
  const [baseline, setBaseline] = useState(initial)
  const [values, setValues] = useState(initial)
  const disabled = !editable || isPending || pending || guard.busy
  const dirty = fields.some(([field]) => values[field] !== baseline[field])
  const draftId = `box-row:${box.id}`
  const dimensionsDirty = fields.slice(0, 3).some(([field]) => values[field] !== baseline[field])
  async function save() {
    const patch: { lengthCm?: number; widthCm?: number; heightCm?: number; grossWeightKg?: number; manualCbm?: null } = {}
    if (dimensionsDirty) {
      const dimensions = [values.lengthCm, values.widthCm, values.heightCm].map(Number)
      if (dimensions.some((n) => !Number.isFinite(n) || n < 0.01 || n > 9999999.99)) {
        toast.error('가로·세로·높이에 0.01 이상인 숫자를 모두 입력해주세요.'); return false
      }
      ;[patch.lengthCm, patch.widthCm, patch.heightCm] = dimensions
      patch.manualCbm = null
    }
    if (values.grossWeightKg !== baseline.grossWeightKg) {
      const weight = Number(values.grossWeightKg)
      if (!Number.isFinite(weight) || weight < 0.001 || weight > 999999999) {
        toast.error('총중량은 0.001kg 이상인 숫자로 입력해주세요.'); return false
      }
      patch.grossWeightKg = weight
    }
    if (!Object.keys(patch).length) return true
    const result = await saveChinaOutboundBoxesMeasurementsAction({ shipmentId, boxIds: [box.id], ...patch })
    if (!result.ok) { toast.error(result.error); return false }
    setBaseline({ ...values }); guard.setDraft(draftId, null); router.refresh(); toast.success('박스 규격·중량을 저장했습니다.'); return true
  }
  function submit() { start(async () => { await guard.runTask(save) }) }
  useChinaWorkDraft(draftId, dirty ? { kind: 'box', label: `박스 ${box.boxNo} 규격·중량`, snapshot: values, save, discard: () => setValues({ ...baseline }) } : null)
  function input(field: typeof fields[number][0]) {
    const label = fields.find(([key]) => key === field)![1]
    return <input aria-label={`박스 ${box.boxNo} ${label}`} type="number" step="any" min={field === 'grossWeightKg' ? '0.001' : '0.01'} value={values[field]} disabled={disabled}
      onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
      onKeyDown={(event) => { if (event.key === 'Enter' && dirty) { event.preventDefault(); submit() } if (event.key === 'Escape' && !pending && !guard.busy) setValues({ ...baseline }) }}
      className={`h-7 w-full min-w-0 rounded border border-blue-200 bg-blue-50 px-1 text-right text-xs outline-none focus:border-blue-500 disabled:border-transparent disabled:bg-muted/30 disabled:text-muted-foreground ${dirty && values[field] !== baseline[field] ? 'border-blue-500 ring-1 ring-blue-300' : ''}`} />
  }
  return <>
    <td className="px-1.5 py-1"><div className="flex items-center gap-1">{input('lengthCm')}<span className="text-xs text-muted-foreground">×</span>{input('widthCm')}<span className="text-xs text-muted-foreground">×</span>{input('heightCm')}</div></td>
    <td className="px-1.5 py-1">{input('grossWeightKg')}</td>
    <td className="px-2 py-1 text-right text-xs tabular-nums">{formatChinaOutboundCbm(calculateChinaOutboundBoxCbm({ ...box, ...values, manualCbm: dimensionsDirty ? null : box.manualCbm })) ?? '—'}</td>
    {actions}
    <td className="px-2 py-1 text-center"><button type="button" aria-label={`박스 ${box.boxNo} 저장하기`} disabled={disabled || !dirty} onClick={submit}
      className="h-7 whitespace-nowrap rounded border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-900 disabled:border-border disabled:bg-muted disabled:text-muted-foreground">{pending ? '저장 중' : '저장하기'}</button></td>
  </>
}
