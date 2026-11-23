'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundCbm } from '@/lib/purchasing/china-outbound-dimensions'
import { saveChinaOutboundBoxDimensionsAction, saveChinaOutboundPackageWeightAction } from '../saas-china-actions'
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
  const [dimensions, setDimensions] = useState({ lengthCm: String(box.lengthCm ?? ''), widthCm: String(box.widthCm ?? ''), heightCm: String(box.heightCm ?? '') })
  const disabled = !editable || isPending || pending || guard.busy
  const draftId = `box-cell:${box.id}`
  function cancel() { setEditing(null); guard.setDraft(draftId, null) }
  async function save() {
    if (!editing) return true
    const number = Number(editing === 'grossWeightKg' ? value : dimensions[editing])
    const maximum = editing === 'grossWeightKg' ? 999_999_999 : 9_999_999.99
    if (!(editing === 'grossWeightKg' ? value : dimensions[editing]).trim() || !Number.isFinite(number) || number < (editing === 'grossWeightKg' ? 0.001 : 0.01) || number > maximum) {
      toast.error('허용 범위의 양수를 입력해주세요.'); return false
    }
    const next = editing === 'grossWeightKg' ? { ...values, grossWeightKg: number } : { ...values, lengthCm: Number(dimensions.lengthCm), widthCm: Number(dimensions.widthCm), heightCm: Number(dimensions.heightCm) }
    if (editing !== 'grossWeightKg' && [next.lengthCm, next.widthCm, next.heightCm].some((n) => n == null || !Number.isFinite(n) || n < 0.01 || n > 9999999.99)) {
      toast.error('가로·세로·높이에 0.01 이상인 숫자를 모두 입력해주세요.'); return false
    }
    const result = editing === 'grossWeightKg'
      ? await saveChinaOutboundPackageWeightAction({ shipmentId, packageId: box.id, kind: 'box', grossWeightKg: number })
      : await saveChinaOutboundBoxDimensionsAction({ shipmentId, boxId: box.id, lengthCm: next.lengthCm!, widthCm: next.widthCm!, heightCm: next.heightCm!, manualCbm: null })
    if (!result.ok) { toast.error(result.error); return false }
    setValues(next); cancel(); router.refresh(); return true
  }
  function submit() { start(async () => { await guard.runTask(save) }) }
  const dirty = editing === 'grossWeightKg' ? value !== String(values.grossWeightKg ?? '') : editing !== null && (['lengthCm', 'widthCm', 'heightCm'] as const).some((field) => dimensions[field] !== String(values[field] ?? ''))
  useChinaWorkDraft(draftId, editing && dirty ? { kind: 'box', label: `박스 ${box.boxNo} 규격·중량`, snapshot: { value, dimensions }, save, discard: cancel } : null)
  function open(field: Field) {
    guard.requestNavigation(() => {
      setEditing(field); setValue(String(values[field] ?? ''))
      setDimensions({ lengthCm: String(values.lengthCm ?? ''), widthCm: String(values.widthCm ?? ''), heightCm: String(values.heightCm ?? '') })
    }, ['box'])
  }
  function keys(event: React.KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); submit() }
    if (event.key === 'Escape' && !pending && !guard.busy) { event.preventDefault(); cancel() }
  }
  return <>{(['lengthCm', 'grossWeightKg'] as const).map((field) => <td key={field} className="relative h-9 border-r px-1.5 py-1 text-xs tabular-nums">
    {editing === field ? field === 'lengthCm' ? <div className="flex items-center gap-1" onKeyDown={keys}>
      {(['lengthCm', 'widthCm', 'heightCm'] as const).map((dimension, index) => <span key={dimension} className="flex min-w-0 flex-1 items-center gap-1">
        {index > 0 && <span className="text-muted-foreground">×</span>}
        <input autoFocus={index === 0} aria-label={`박스 ${box.boxNo} ${fields.find(([key]) => key === dimension)![1]}`} type="number" step="0.01" value={dimensions[dimension]}
          disabled={isPending || pending || guard.busy} onChange={(event) => setDimensions((current) => ({ ...current, [dimension]: event.target.value }))}
          className="h-7 w-full min-w-0 rounded border border-blue-500 bg-background px-1 text-right outline-none" />
      </span>)}<span className="text-muted-foreground">cm</span>
    </div> : <input autoFocus aria-label={`박스 ${box.boxNo} 총중량(kg)`} type="number" step="any" value={value} disabled={isPending || pending || guard.busy}
      onChange={(event) => setValue(event.target.value)} onKeyDown={keys} className="h-7 w-full rounded border border-blue-500 bg-background px-1 text-right outline-none" />
    : <button type="button" aria-label={`박스 ${box.boxNo} ${field === 'lengthCm' ? '규격(cm)' : '총중량(kg)'} 편집`} disabled={disabled} title="더블클릭 또는 Enter로 수정"
      onDoubleClick={() => open(field)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); open(field) } }}
      className="h-7 w-full cursor-cell truncate rounded px-1 text-left hover:bg-muted disabled:cursor-default">
      {field === 'lengthCm' ? `${values.lengthCm ?? '—'} × ${values.widthCm ?? '—'} × ${values.heightCm ?? '—'} cm` : values.grossWeightKg ?? '—'}
    </button>}
    {editing === field && <div className="absolute right-0 top-full z-30 flex gap-1 whitespace-nowrap rounded border bg-popover p-1 shadow-md">
      <button type="button" onClick={submit} disabled={isPending || pending || guard.busy} className="rounded bg-primary px-2 py-1 text-primary-foreground">저장</button>
      <button type="button" onClick={cancel} disabled={pending || guard.busy} className="rounded border px-2 py-1">취소</button>
    </div>}
  </td>)}<td className="border-r px-2 py-1 text-right text-xs tabular-nums">{formatChinaOutboundCbm(calculateChinaOutboundBoxCbm({ ...box, ...values, manualCbm: null })) ?? '—'}</td></>
}
