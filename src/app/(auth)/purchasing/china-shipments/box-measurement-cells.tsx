'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundCbm } from '@/lib/purchasing/china-outbound-dimensions'
import { saveChinaOutboundBoxDimensionsAction, saveChinaOutboundPackageWeightAction } from '../saas-china-actions'
import { BoxDimensionsEditor } from './outbound-package-editors'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import type { SavedBoxSummary } from './china-shipments-board'

const fields = [['lengthCm', '가로(cm)'], ['widthCm', '세로(cm)'], ['heightCm', '높이(cm)'], ['grossWeightKg', '총중량(kg)']] as const
type Field = typeof fields[number][0]
export function BoxMeasurementCells({ shipmentId, box, editable, isPending }: {
  shipmentId: string; box: SavedBoxSummary['box']; editable: boolean; isPending: boolean
}) {
  const guard = useChinaWorkGuard()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(([field]) => [field, box[field]])) as Record<Field, number | null | undefined>)
  const [editing, setEditing] = useState<Field | null>(null)
  const [value, setValue] = useState('')
  const disabled = !editable || isPending || pending || guard.busy
  const draftId = `box-cell:${box.id}`
  const missingDimensions = [values.lengthCm, values.widthCm, values.heightCm].some((n) => n == null || n <= 0)
  const initialDimensions = editing !== null && editing !== 'grossWeightKg' && missingDimensions
  function cancel() { setEditing(null); guard.setDraft(draftId, null) }
  async function save() {
    if (!editing) return true
    const number = Number(value)
    const maximum = editing === 'grossWeightKg' ? 999_999_999 : 9_999_999.99
    if (!value.trim() || !Number.isFinite(number) || number < (editing === 'grossWeightKg' ? 0.001 : 0.01) || number > maximum) {
      toast.error('허용 범위의 양수를 입력해주세요.'); return false
    }
    const next = { ...values, [editing]: number }
    if (editing !== 'grossWeightKg' && [next.lengthCm, next.widthCm, next.heightCm].some((n) => n == null || n <= 0)) {
      toast.error('다른 가로·세로·높이가 비어 있습니다. 1단계 박스분할에서 최초 규격을 입력해주세요.'); return false
    }
    const result = editing === 'grossWeightKg'
      ? await saveChinaOutboundPackageWeightAction({ shipmentId, packageId: box.id, kind: 'box', grossWeightKg: number })
      : await saveChinaOutboundBoxDimensionsAction({ shipmentId, boxId: box.id, lengthCm: next.lengthCm!, widthCm: next.widthCm!, heightCm: next.heightCm!, manualCbm: null })
    if (!result.ok) { toast.error(result.error); return false }
    setValues(next); cancel(); router.refresh(); return true
  }
  function submit() { start(async () => { await guard.runTask(save) }) }
  useChinaWorkDraft(draftId, editing && value !== String(values[editing] ?? '') ? {
    kind: 'box', label: `박스 ${box.boxNo} ${fields.find(([field]) => field === editing)![1]}`, snapshot: value, save, discard: cancel,
  } : null)
  return <>{fields.map(([field, label]) => <td key={field} className="relative h-9 border-r px-1.5 py-1 text-right text-xs tabular-nums">
    {editing === field && !initialDimensions ? <input autoFocus aria-label={`박스 ${box.boxNo} ${label}`} type="number" step="any" value={value} disabled={isPending || pending || guard.busy}
      onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); submit() }
        if (event.key === 'Escape' && !pending && !guard.busy) { event.preventDefault(); cancel() }
      }} className="h-7 w-full rounded border border-blue-500 bg-background px-1 text-right outline-none" />
      : <button type="button" aria-label={`박스 ${box.boxNo} ${label} 편집`} disabled={disabled} title="더블클릭 또는 Enter로 수정"
        onDoubleClick={() => guard.requestNavigation(() => { setEditing(field); setValue(String(values[field] ?? '')) }, ['box'])}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); guard.requestNavigation(() => { setEditing(field); setValue(String(values[field] ?? '')) }, ['box']) } }}
        className="h-7 w-full cursor-cell truncate rounded px-1 text-right hover:bg-muted disabled:cursor-default">{values[field] ?? '—'}</button>}
    {editing === field && initialDimensions ? <div className="absolute right-0 top-full z-30 w-80 rounded border bg-popover p-3 text-left shadow-md">
      <BoxDimensionsEditor shipmentId={shipmentId} box={box} editable={editable} isPending={isPending} automaticCbm />
      <button type="button" onClick={() => guard.requestNavigation(cancel, ['box'])} className="mt-2 rounded border px-2 py-1">닫기</button>
    </div> : editing === field && <div className="absolute right-0 top-full z-30 flex gap-1 whitespace-nowrap rounded border bg-popover p-1 shadow-md">
      <button type="button" onClick={submit} disabled={isPending || pending || guard.busy} className="rounded bg-primary px-2 py-1 text-primary-foreground">저장</button>
      <button type="button" onClick={cancel} disabled={pending || guard.busy} className="rounded border px-2 py-1">취소</button>
    </div>}
  </td>)}<td className="border-r px-2 py-1 text-right text-xs tabular-nums">{formatChinaOutboundCbm(calculateChinaOutboundBoxCbm({ ...box, ...values, manualCbm: null })) ?? '—'}</td></>
}
