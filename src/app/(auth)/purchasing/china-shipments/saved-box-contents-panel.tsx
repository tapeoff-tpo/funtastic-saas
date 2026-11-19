'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Package, Printer } from 'lucide-react'
import { calculateChinaOutboundBoxCbm, formatChinaOutboundBoxDimensions, formatChinaOutboundCbm } from '@/lib/purchasing/china-outbound-dimensions'
import { saveChinaOutboundBoxesMeasurementsAction } from '../saas-china-actions'
import { BoxDimensionsEditor, PackageWeightEditor } from './outbound-package-editors'
import { ContentsToggle } from './contents-toggle'
import { useChinaWorkDraft, useChinaWorkGuard } from './unsaved-china-work'
import type { SavedBoxSummary } from './china-shipments-board'

const boxNumberCollator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })
const productKey = (item: SavedBoxSummary['items'][number]['item']) => JSON.stringify([item.sku, item.optionName ?? ''])
const measurementFields = [['lengthCm', '가로(cm)'], ['widthCm', '세로(cm)'], ['heightCm', '높이(cm)'], ['grossWeightKg', '총중량(kg)']] as const
type Measurements = Record<typeof measurementFields[number][0], string>
type BulkSnapshot = { selected: string[]; measurements: Measurements }
const blankMeasurements: Measurements = { lengthCm: '', widthCm: '', heightCm: '', grossWeightKg: '' }

export function SavedBoxContentsPanel({ shipmentId, summaries, filter, editable, isPending, onFilterChange, onEditItem }: {
  shipmentId: string; summaries: SavedBoxSummary[]; filter: 'all' | 'saved'; editable: boolean; isPending: boolean
  onFilterChange: (filter: 'all' | 'saved') => void; onEditItem: (itemId: string) => void
}) {
  const guard = useChinaWorkGuard()
  const router = useRouter()
  const [pending, start] = useTransition()
  const draftId = `bulk-box-measurements:${shipmentId}`
  const [selected, setSelected] = useState<Set<string>>(() => new Set((guard.getDraft(draftId)?.snapshot as BulkSnapshot | undefined)?.selected ?? []))
  const [measurements, setMeasurements] = useState<Measurements>(() => (guard.getDraft(draftId)?.snapshot as BulkSnapshot | undefined)?.measurements ?? { ...blankMeasurements })
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const savedBoxes = summaries.filter((box) => box.quantity > 0)
  const visibleBoxes = [...(filter === 'all' ? summaries : savedBoxes)].sort((left, right) => boxNumberCollator.compare(left.box.boxNo, right.box.boxNo))
  const canEditBox = (summary: SavedBoxSummary) => editable && summary.box.editable && summary.box.status === 'open'
  const selectableIds = visibleBoxes.filter(canEditBox).map((summary) => summary.box.id)
  const selectedIds = summaries.filter((summary) => canEditBox(summary) && selected.has(summary.box.id)).map((summary) => summary.box.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
  const bulkDirty = selectedIds.length > 0 && Object.values(measurements).some((value) => value.trim())
  const disabled = isPending || pending || guard.busy
  function toggleBox(id: string, checked: boolean) {
    setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })
  }
  function toggleExpanded(id: string) {
    setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  async function saveBulk() {
    if (!selectedIds.length) { toast.error('수정할 박스를 선택해주세요.'); return false }
    if (selectedIds.some((id) => guard.getDraft(`box-dimensions:${id}`) || guard.getDraft(`weight:box:${id}`))) {
      toast.error('선택한 박스의 개별 수정 내용을 먼저 저장해주세요.')
      return false
    }
    const hasDimensions = [measurements.lengthCm, measurements.widthCm, measurements.heightCm].some((value) => value.trim())
    if (hasDimensions && [measurements.lengthCm, measurements.widthCm, measurements.heightCm].some((value) => !value.trim() || !Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 9_999_999.99)) {
      toast.error('일괄 적용할 가로·세로·높이를 모두 입력해주세요.')
      return false
    }
    const hasWeight = !!measurements.grossWeightKg.trim()
    if (hasWeight && (!Number.isFinite(Number(measurements.grossWeightKg)) || Number(measurements.grossWeightKg) < 0.001 || Number(measurements.grossWeightKg) > 999_999_999)) {
      toast.error('일괄 적용할 총중량은 0보다 큰 숫자로 입력해주세요.')
      return false
    }
    if (!hasDimensions && !hasWeight) { toast.error('일괄 적용할 규격이나 무게를 입력해주세요.'); return false }
    const result = await saveChinaOutboundBoxesMeasurementsAction({
      shipmentId, boxIds: selectedIds,
      ...(hasDimensions ? { lengthCm: Number(measurements.lengthCm), widthCm: Number(measurements.widthCm), heightCm: Number(measurements.heightCm) } : {}),
      ...(hasWeight ? { grossWeightKg: Number(measurements.grossWeightKg) } : {}),
    })
    if (!result.ok) { toast.error(result.error); return false }
    setSelected(new Set()); setMeasurements({ ...blankMeasurements }); guard.setDraft(draftId, null)
    router.refresh(); toast.success('선택한 박스의 규격·중량을 저장했습니다.'); return true
  }
  useChinaWorkDraft(draftId, bulkDirty ? {
    kind: 'box', label: '박스 규격·중량 일괄 수정', snapshot: { selected: selectedIds, measurements }, save: saveBulk, savePriority: 10,
    discard: () => { setSelected(new Set()); setMeasurements({ ...blankMeasurements }) },
  } : null)
  return <section className="overflow-hidden rounded-xl border border-slate-300 bg-slate-50/60 shadow-sm" aria-labelledby="saved-box-contents-title">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-100 px-4 py-4">
      <h3 id="saved-box-contents-title" className="font-semibold">저장된 박스 현황</h3>
      <div role="group" aria-label="저장된 박스 필터" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={filter === 'saved'} onClick={() => { if (filter !== 'saved') guard.requestNavigation(() => onFilterChange('saved')) }} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">저장된 박스 (내용 있음) {savedBoxes.length.toLocaleString('ko-KR')}</button>
        <button type="button" aria-pressed={filter === 'all'} onClick={() => { if (filter !== 'all') guard.requestNavigation(() => onFilterChange('all')) }} className="h-8 rounded-md border px-3 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground">전체 박스 {summaries.length.toLocaleString('ko-KR')}</button>
        <button type="button" onClick={() => setExpanded(new Set(visibleBoxes.map((summary) => summary.box.id)))} className="h-8 rounded-md border px-3 text-xs">전체 펼치기</button>
        <button type="button" onClick={() => setExpanded(new Set())} className="h-8 rounded-md border px-3 text-xs">전체 접기</button>
      </div>
    </div>
    {editable && <div className="space-y-2 border-b bg-muted/10 px-4 py-3" role="group" aria-label="선택한 박스 일괄 수정">
      <div className="flex flex-wrap items-end gap-2"><p className="self-center text-xs font-semibold">선택 {selectedIds.length.toLocaleString('ko-KR')}개</p>{measurementFields.map(([key, label]) => <label key={key} className="text-xs">{label}<input type="number" aria-label={`일괄 ${label}`} value={measurements[key]} onChange={(event) => setMeasurements((current) => ({ ...current, [key]: event.target.value }))} disabled={disabled} min={key === 'grossWeightKg' ? '0.001' : '0.01'} max={key === 'grossWeightKg' ? '999999999' : '9999999.99'} step={key === 'grossWeightKg' ? '0.001' : '0.01'} className="mt-1 block h-8 w-24 rounded-md border bg-background px-2" /></label>)}<button type="button" disabled={disabled || !selectedIds.length} onClick={() => start(async () => { await guard.runTask(saveBulk) })} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">선택 박스 일괄 저장</button></div>
      <p className="text-xs text-muted-foreground">빈칸은 기존 값을 유지합니다. 규격은 가로·세로·높이를 모두 입력해주세요.</p>
    </div>}
    {!visibleBoxes.length ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">저장된 박스가 없습니다. 품목별 박스분할을 저장하면 이곳에서 내용과 수량을 확인할 수 있습니다.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[1400px] border-separate border-spacing-y-2 px-3 pb-3 text-sm">
      <caption className="sr-only">박스번호 순 적재 상품, 수량, 규격·중량, 파렛트 위치, 쉽먼트 인쇄 및 다운로드</caption>
      <thead className="text-xs text-slate-600"><tr><th className="px-3 py-2"><input type="checkbox" aria-label="수정 가능한 박스 전체 선택" checked={allSelected} disabled={disabled || !selectableIds.length} onChange={(event) => setSelected((current) => { const next = new Set(current); for (const id of selectableIds) { if (event.target.checked) next.add(id); else next.delete(id) } return next })} className="size-3.5 accent-primary" /></th>{['박스번호', '적재 상품', '총수량', '박스 규격·중량', '파렛트 위치', '부착용 쉽먼트', '관리'].map((label) => <th key={label} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{label}</th>)}</tr></thead>
      <tbody>{visibleBoxes.map((summary) => {
        const mixed = new Set(summary.items.map(({ item }) => productKey(item))).size > 1
        const boxEditable = canEditBox(summary)
        const open = expanded.has(summary.box.id)
        const href = `/api/purchasing/china-shipments/${encodeURIComponent(shipmentId)}/labels?boxId=${encodeURIComponent(summary.box.id)}`
        return <tr key={summary.box.id} aria-label={`박스 ${summary.box.boxNo}`} className={`align-top [&>td]:border-y [&>td]:border-slate-200 [&>td:first-child]:rounded-l-lg [&>td:first-child]:border-l-4 [&>td:last-child]:rounded-r-lg [&>td:last-child]:border-r ${selectedIds.includes(summary.box.id) ? 'bg-cyan-50 [&>td:first-child]:border-l-cyan-600' : open ? 'bg-blue-50/80 [&>td:first-child]:border-l-blue-600' : 'bg-background [&>td:first-child]:border-l-slate-300'}`}>
          <td className="px-3 py-3"><input type="checkbox" aria-label={`박스 ${summary.box.boxNo} 선택`} checked={selectedIds.includes(summary.box.id)} disabled={disabled || !boxEditable} onChange={(event) => toggleBox(summary.box.id, event.target.checked)} className="size-3.5 accent-primary" /></td>
          <td className="px-3 py-3 font-medium"><div className="flex items-center gap-2"><span className={`inline-flex min-w-14 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold shadow-sm ${open ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-900 ring-1 ring-inset ring-slate-300'}`}><Package aria-hidden="true" className="size-4 shrink-0" /><span data-no-translate>{summary.box.boxNo}</span></span><ContentsToggle expanded={open} label={`박스 ${summary.box.boxNo} ${open ? '접기' : '펼치기'}`} onClick={() => toggleExpanded(summary.box.id)} /></div>{mixed && <span className="mt-2 block w-fit whitespace-nowrap rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">혼합박스</span>}</td>
          <td className="px-3 py-3 text-xs leading-5"><p hidden={open} className="font-medium text-slate-600">{summary.items.length ? `상품 ${new Set(summary.items.map(({ item }) => productKey(item))).size}종` : '내용 없음'}</p><div hidden={!open} className="rounded-md border border-blue-100 border-l-4 border-l-blue-400 bg-background px-3 py-1 shadow-sm">{summary.items.length ? <ul className="divide-y divide-slate-100">{summary.items.map(({ item, quantity }) => <li key={item.id} className="flex items-start justify-between gap-3 py-2"><span data-no-translate className="min-w-0 break-words text-[13px] leading-6 text-slate-900">{item.sku} · {item.productName}{item.optionName ? ` · ${item.optionName}` : ''}{item.chineseProductName ? ` / ${item.chineseProductName}` : ''}</span>{' '}<span className="mt-0.5 shrink-0 rounded bg-blue-50 px-2 py-0.5 font-semibold tabular-nums text-blue-900">{quantity.toLocaleString('ko-KR')}개</span></li>)}</ul> : <span className="text-muted-foreground">{summary.quantity ? '품목 정보를 찾지 못했습니다.' : '내용 없음'}</span>}</div></td>
          <td className="whitespace-nowrap px-3 py-3 font-semibold tabular-nums text-slate-900">{summary.quantity.toLocaleString('ko-KR')}개</td>
          <td className="min-w-[350px] px-3 py-3"><div hidden={open} className="space-y-1 text-xs"><p className="font-medium text-slate-900">{formatChinaOutboundBoxDimensions(summary.box) ?? '미입력'}</p><p className="text-slate-600">총중량(kg): {summary.box.grossWeightKg ?? '미입력'} · CBM: {formatChinaOutboundCbm(calculateChinaOutboundBoxCbm(summary.box)) ?? '미입력'}</p></div><div hidden={!open} className="space-y-3 rounded-lg border border-blue-100 bg-background p-3">
            <BoxDimensionsEditor key={`${summary.box.id}:${summary.box.lengthCm}:${summary.box.widthCm}:${summary.box.heightCm}`} shipmentId={shipmentId} box={summary.box} editable={boxEditable} isPending={isPending} />
            <PackageWeightEditor key={`${summary.box.id}:${summary.box.grossWeightKg}`} shipmentId={shipmentId} packageId={summary.box.id} packageNo={summary.box.boxNo} kind="box" initialWeight={summary.box.grossWeightKg} editable={boxEditable} isPending={isPending} compact />
          </div></td>
          <td className="whitespace-nowrap px-3 py-3 text-xs">{summary.palletNo ? <>파렛트 <span data-no-translate>{summary.palletNo}</span></> : <span className="text-muted-foreground">미배정</span>}</td>
          <td className="px-3 py-3"><div>{summary.quantity > 0 ? <><a href={`${href}&format=print`} target="_blank" rel="noopener noreferrer" aria-label={`${summary.box.boxNo} 박스 쉽먼트 바로 인쇄`} className="mb-1 mr-1 inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"><Printer className="size-3.5" />바로 인쇄</a><a href={href} aria-label={`${summary.box.boxNo} 박스 부착용 쉽먼트 다운로드`} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"><Download className="size-3.5" />박스별 다운로드</a></> : '-'}</div></td>
          <td className="space-y-2 px-3 py-3"><div hidden={!open}>{summary.quantity > 0 && boxEditable ? <div className="flex flex-col gap-1">{summary.items.map(({ item }) => <button key={item.id} type="button" disabled={isPending || guard.busy} onClick={() => guard.requestNavigation(() => onEditItem(item.id))} aria-label={mixed ? `${summary.box.boxNo} 박스 ${item.sku} 내용 수정` : `${summary.box.boxNo} 박스 내용 수정`} className="h-8 whitespace-nowrap rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-50">{mixed ? <><span data-no-translate>{item.sku}</span> 수정</> : '수정'}</button>)}</div> : '-'}</div></td>
        </tr>
      })}</tbody>
    </table></div>}
  </section>
}
