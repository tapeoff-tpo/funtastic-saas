'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { PurchasingProductImageButton } from '@/components/purchasing-product-image'
import type { ProductImageResult } from '@/lib/purchasing/product-image-catalogue'
import { Button } from '@/components/ui/button'
import { blankInspectionBox, inspectionSummary, STICKER_STATUS_LABELS, type InspectionParcel, type InspectionStickerStatus, type PurchaseInspection } from '@/lib/purchasing/purchase-inspection'
import type { PurchaseInspectionIssue } from '@/lib/purchasing/purchase-inspection-issues'
import { PurchaseInspectionIssueList, PurchaseInspectionIssueRegister } from './purchase-inspection-issues'
import { PurchaseInspectionLabelPanel } from './purchase-inspection-label-panel'

type Detail = { id: string; status: string; productName: string; sku: string; inspection: PurchaseInspection; inspectionIssues?: PurchaseInspectionIssue[]; imageUrls: string[] }
type BoxCopySource = { parcelId: string; boxId: string }

function canCopyInspectionBox(box: InspectionParcel['boxes'][number]) {
  return typeof box.quantity === 'number'
    && Number.isInteger(box.quantity)
    && box.quantity >= 0
    && [box.lengthCm, box.widthCm, box.heightCm].every((value) => (
      typeof value === 'number' && Number.isFinite(value) && value > 0
    ))
}

function withSingleParcelQuantityDefault(detail: Detail) {
  const inspection = detail.inspection
  const [parcel] = inspection.parcels
  const [box] = parcel?.boxes ?? []
  const editable = detail.status === 'purchase_completed' || detail.status === 'inspecting'
  if (!editable || inspection.parcels.length !== 1 || !parcel || parcel.boxes.length !== 1 || !box || box.quantity !== null) {
    return detail
  }

  return {
    ...detail,
    inspection: {
      ...inspection,
      parcels: [{
        ...parcel,
        boxes: [{ ...box, quantity: inspection.expectedQuantity }],
      }],
    },
  }
}

export function PurchaseInspectionButton({ id, productName, imageData, mode = 'inspection' }: { id: string; productName: string; imageData?: ProductImageResult; mode?: 'image' | 'inspection' }) {
  const [open, setOpen] = useState(false)
  if (mode === 'image') return <PurchasingProductImageButton purchaseItemId={id} productName={productName} imageData={imageData} />
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>송장·검수</Button>
    {open && <InspectionDialog id={id} onClose={() => setOpen(false)} />}
  </>
}

function InspectionDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [acknowledgeMismatch, setAcknowledgeMismatch] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [boxCopySource, setBoxCopySource] = useState<BoxCopySource | null>(null)
  const [boxCopyCount, setBoxCopyCount] = useState('1')
  useEffect(() => { ref.current?.showModal() }, [])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/purchasing/purchase-requests/${id}/inspection`, { cache: 'no-store', signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || '검수 정보를 불러오지 못했습니다.')
        if (!controller.signal.aborted) {
          const initial = withSingleParcelQuantityDefault(body as Detail)
          setData(initial)
          setAcknowledgeMismatch(Boolean(initial.inspection.checkedAt))
          setError('')
          setDirty(false)
        }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '불러오기에 실패했습니다.') }
    })()
    return () => controller.abort()
  }, [id, attempt])

  const inspection = data?.inspection
  const editable = data && ['purchase_completed', 'inspecting'].includes(data.status)
  const summary = inspection ? inspectionSummary(inspection) : null
  const remainingBoxCapacity = summary ? Math.max(0, 500 - summary.boxCount) : 0
  const copyableBoxes = inspection?.parcels.flatMap((parcel, parcelIndex) => parcel.boxes
    .flatMap((box, boxIndex) => canCopyInspectionBox(box) ? [{ parcelId: parcel.id, boxId: box.id, parcelIndex, boxIndex }] : [])) ?? []
  function changeParcels(parcels: InspectionParcel[]) {
    setData((current) => current ? { ...current, inspection: { ...current.inspection, parcels, checkedAt: null } } : current)
    setDirty(true); setAcknowledgeMismatch(false)
  }
  function beginBoxCopy(parcelId: string, boxId: string) {
    if (!inspection) return
    const source = inspection.parcels.find((parcel) => parcel.id === parcelId)?.boxes.find((box) => box.id === boxId)
    if (!source || !canCopyInspectionBox(source)) {
      toast.error('수량과 가로·세로·높이를 입력한 박스만 복사할 수 있습니다.')
      return
    }
    setBoxCopySource({ parcelId, boxId })
    setBoxCopyCount('1')
  }
  function copyBoxes() {
    if (!inspection || !boxCopySource) return
    const count = Number(boxCopyCount)
    const remainingCapacity = 500 - inspection.parcels.reduce((total, parcel) => total + parcel.boxes.length, 0)
    if (remainingCapacity < 1) {
      toast.error('검수 한 건에는 박스를 최대 500개까지 입력할 수 있습니다.')
      return
    }
    if (!Number.isInteger(count) || count < 1 || count > remainingCapacity) {
      toast.error(`추가할 박스 개수는 1~${remainingCapacity.toLocaleString('ko-KR')} 사이의 정수로 입력해주세요.`)
      return
    }
    const sourceParcel = inspection.parcels.find((parcel) => parcel.id === boxCopySource.parcelId)
    const sourceBox = sourceParcel?.boxes.find((box) => box.id === boxCopySource.boxId)
    if (!sourceParcel || !sourceBox || !canCopyInspectionBox(sourceBox)) {
      toast.error('복사할 박스 정보를 다시 확인해주세요.')
      setBoxCopySource(null)
      return
    }
    const copiedBoxes = Array.from({ length: count }, () => ({ ...sourceBox, id: crypto.randomUUID() }))
    changeParcels(inspection.parcels.map((parcel) => parcel.id === sourceParcel.id
      ? { ...parcel, boxes: [...parcel.boxes, ...copiedBoxes] }
      : parcel,
    ))
    setBoxCopySource(null)
    toast.success(`${count.toLocaleString('ko-KR')}개 박스를 복사했습니다.`)
  }
  function close() {
    if (dirty && !confirm('저장하지 않은 검수 입력을 닫으시겠습니까?')) return
    ref.current?.close()
  }
  async function save(complete: boolean) {
    if (!data || !inspection) return
    if (complete && !inspection.stickerStatus) {
      toast.error('스티커 부착 상태를 선택해주세요.')
      return
    }
    setPending(true)
    try {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}/inspection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: inspection.revision, parcels: inspection.parcels, complete, acknowledgeMismatch, resolutionNote: inspection.resolutionNote, stickerStatus: inspection.stickerStatus }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '검수 저장에 실패했습니다.')
      setData((current) => current ? { ...current, status: 'inspecting', inspection: body.inspection } : current)
      setDirty(false)
      if (complete) {
        const moved = await fetch(`/api/purchasing/purchase-requests/${id}/status`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'china_arrived' }),
        })
        if (!moved.ok) { const detail = await moved.json(); throw new Error(detail.error || '중국창고도착 처리에 실패했습니다.') }
        toast.success('검수를 완료하고 실제 입고수량을 반영했습니다.')
        ref.current?.close()
      } else toast.success('송장·박스를 저장하고 검수 단계로 이동했습니다.')
      router.refresh()
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : '검수 저장에 실패했습니다.') }
    finally { setPending(false) }
  }

  return <dialog ref={ref} aria-labelledby="purchase-inspection-title" onClose={onClose}
    onCancel={(event) => { event.preventDefault(); if (!pending) close() }}
    className="fixed inset-0 m-auto max-h-[92dvh] w-[min(64rem,96vw)] rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40">
    <div className="sticky top-0 z-10 border-b bg-background p-4">
      <div className="flex items-center justify-between gap-3"><h2 id="purchase-inspection-title" className="text-lg font-semibold">송장·검수</h2><Button type="button" variant="outline" disabled={pending} onClick={close}>닫기</Button></div>
      {data && inspection && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p data-no-translate>{data.sku} · {data.productName}</p>
        <label className="flex flex-wrap items-center gap-2 text-xs font-medium">
          스티커 부착 상태
          <select value={inspection.stickerStatus ?? ''} disabled={pending || !editable} className="h-8 rounded-md border bg-background px-2 text-sm"
            onChange={(event) => {
              const stickerStatus = event.target.value as InspectionStickerStatus
              setData({ ...data, inspection: { ...inspection, stickerStatus } })
              setDirty(true)
            }}>
            <option value="" disabled>미확인</option>
            {Object.entries(STICKER_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </label>
      </div>}
    </div>
    <div className="space-y-4 p-4">
      {error ? <div role="alert" className="text-sm text-red-700">{error}<Button type="button" variant="outline" className="ml-3" onClick={() => setAttempt((value) => value + 1)}>다시 불러오기</Button></div> : !data ? <p>불러오는 중…</p> : null}
      {data && inspection && summary && <>
        <PurchaseInspectionLabelPanel id={id} canUpload={editable || data.status === 'china_arrived'} />
        <fieldset disabled={pending || !editable} className="space-y-4">
          {inspection.parcels.map((parcel, parcelIndex) => <section key={parcel.id} className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1 text-sm">
                <div className="flex items-center gap-1">
                  <label htmlFor={`inspection-tracking-${parcel.id}`}>운송장번호</label>
                  {parcel.trackingNumber.trim() ? (
                    <a
                      href={`https://www.baidu.com/s?wd=${encodeURIComponent(parcel.trackingNumber.trim())}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="바이두에서 송장번호 조회"
                      aria-label="바이두에서 송장번호 조회"
                      className="inline-flex size-5 items-center justify-center rounded border border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
                <input id={`inspection-tracking-${parcel.id}`} aria-label={`운송장번호 ${parcelIndex + 1}`} value={parcel.trackingNumber} maxLength={100} className="mt-1 block w-full rounded border bg-background p-2"
                onChange={(event) => changeParcels(inspection.parcels.map((row) => row.id === parcel.id ? { ...row, trackingNumber: event.target.value } : row))} />
              </div>
              <span className="pb-2 text-sm">송장별 입고수량: <strong>{parcel.boxes.reduce((sum, box) => sum + (box.quantity ?? 0), 0)}</strong>개</span>
              <Button type="button" variant="outline" size="sm" onClick={() => changeParcels(inspection.parcels.filter((row) => row.id !== parcel.id))}>송장 삭제</Button>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-sm">
              <thead><tr>{['박스', '입고수량', '가로(cm)', '세로(cm)', '높이(cm)', '무게(kg)', 'CBM', ''].map((text, index) => <th key={index} className="p-1 text-left font-medium">{text}</th>)}</tr></thead>
              <tbody>{parcel.boxes.map((box, boxIndex) => <tr key={box.id}>
                <td className="p-1">{boxIndex + 1}</td>
                {(['quantity', 'lengthCm', 'widthCm', 'heightCm', 'weightKg'] as const).map((field) => <td key={field} className="p-1">
                  <input type="number" aria-label={`${parcelIndex + 1}번 송장 ${boxIndex + 1}번 박스 ${field}`} min={field === 'quantity' ? 0 : 0.001} step={field === 'quantity' ? 1 : 'any'} value={box[field] ?? ''} className="w-24 rounded border bg-background p-1.5"
                    onChange={(event) => { const value = event.target.value === '' ? null : Number(event.target.value); changeParcels(inspection.parcels.map((row) => row.id === parcel.id ? { ...row, boxes: row.boxes.map((entry) => entry.id === box.id ? { ...entry, [field]: value } : entry) } : row)) }} />
                </td>)}
                <td className="p-1 tabular-nums">{box.lengthCm && box.widthCm && box.heightCm ? (box.lengthCm * box.widthCm * box.heightCm / 1_000_000).toFixed(6) : '—'}</td>
                <td className="p-1"><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="sm" aria-label={`${parcelIndex + 1}번 송장 ${boxIndex + 1}번 박스 복사`} title={remainingBoxCapacity < 1 ? '검수 한 건에는 박스를 최대 500개까지 입력할 수 있습니다.' : canCopyInspectionBox(box) ? undefined : '수량과 가로·세로·높이를 입력한 박스만 복사할 수 있습니다.'} disabled={remainingBoxCapacity < 1 || !canCopyInspectionBox(box)} onClick={() => beginBoxCopy(parcel.id, box.id)}>박스 복사</Button><Button type="button" variant="ghost" size="sm" disabled={parcel.boxes.length === 1} onClick={() => { if (boxCopySource?.boxId === box.id) setBoxCopySource(null); changeParcels(inspection.parcels.map((row) => row.id === parcel.id ? { ...row, boxes: row.boxes.filter((entry) => entry.id !== box.id) } : row)) }}>삭제</Button></div></td>
              </tr>)}</tbody>
            </table></div>
            {boxCopySource?.parcelId === parcel.id ? (() => {
              const sourceIndex = parcel.boxes.findIndex((box) => box.id === boxCopySource.boxId)
              if (sourceIndex < 0) return null
              return <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2 text-sm">
                <label className="grid gap-1 text-xs">복사할 박스
                  <select value={boxCopySource.boxId} className="rounded border bg-background p-1.5 text-sm" onChange={(event) => {
                    const source = copyableBoxes.find((entry) => entry.boxId === event.target.value)
                    if (source) setBoxCopySource({ parcelId: source.parcelId, boxId: source.boxId })
                  }}>{copyableBoxes.map((entry) => <option key={entry.boxId} value={entry.boxId}>{`${entry.parcelIndex + 1}번 송장 ${entry.boxIndex + 1}번 박스 복사`}</option>)}</select>
                </label>
                <label className="grid gap-1 text-xs">추가할 박스 개수
                  <input aria-label={`${parcelIndex + 1}번 송장 ${sourceIndex + 1}번 박스 복사 개수`} type="number" min="1" max={Math.max(1, remainingBoxCapacity)} step="1" value={boxCopyCount} className="w-28 rounded border bg-background p-1.5 text-sm" onChange={(event) => setBoxCopyCount(event.target.value)} />
                </label>
                <Button type="button" size="sm" disabled={remainingBoxCapacity < 1} onClick={copyBoxes}>복사 추가</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setBoxCopySource(null)}>취소</Button>
              </div>
            })() : null}
          </section>)}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={remainingBoxCapacity < 1 || inspection.parcels.length >= 100} title={remainingBoxCapacity < 1 ? '검수 한 건에는 박스를 최대 500개까지 입력할 수 있습니다.' : undefined} onClick={() => changeParcels([...inspection.parcels, { id: crypto.randomUUID(), trackingNumber: '', boxes: [blankInspectionBox(crypto.randomUUID())] }])}>송장 추가</Button>
            <Button type="button" variant="outline" disabled={remainingBoxCapacity < 1 || copyableBoxes.length === 0} onClick={() => {
              const source = copyableBoxes[0]
              if (source) beginBoxCopy(source.parcelId, source.boxId)
            }}>박스 복사</Button>
          </div>
          {((inspection.parcels.length > 0 && summary.hasError) || inspection.resolutionNote) && <div className={`space-y-2 rounded-lg border p-3 ${summary.hasError ? 'border-red-200 bg-red-50/50' : 'bg-muted/20'}`}>
            {editable && summary.hasError && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acknowledgeMismatch} onChange={(event) => setAcknowledgeMismatch(event.target.checked)} />구매수량과 실제 입고수량의 차이를 확인했습니다.</label>}
            <label className="block text-sm">수량 차이 비고<textarea value={inspection.resolutionNote} maxLength={2_000} className="mt-1 block w-full rounded border bg-background p-2" onChange={(event) => { setData({ ...data, inspection: { ...inspection, resolutionNote: event.target.value } }); setDirty(true) }} /></label>
          </div>}
        </fieldset>
        <section className="space-y-3 rounded-lg border p-3">
          <div>
            <h3 className="text-sm font-semibold">등록된 검수 오류</h3>
            <p className="mt-1 text-xs text-muted-foreground">구매 담당자는 구매 목록의 구매 정보에서 내용을 수정한 뒤 저장할 수 있습니다.</p>
          </div>
          <PurchaseInspectionIssueList purchaseItemId={id} issues={data.inspectionIssues ?? []} />
          {editable ? <PurchaseInspectionIssueRegister
            purchaseItemId={id}
            disabled={pending}
            onRegistered={(saved) => {
              setData((current) => current ? {
                ...current,
                status: 'inspecting',
                // Registering an issue is persisted immediately, but the
                // inspector may still have unsaved box measurements in this
                // dialog. Do not silently rebase that draft onto a server
                // revision; a true concurrent parcel edit must still fail the
                // normal optimistic revision check on the later save.
                inspection: {
                  ...current.inspection,
                  hasReportedIssue: saved.inspection.hasReportedIssue,
                },
                inspectionIssues: [...(current.inspectionIssues ?? []), saved.issue],
              } : current)
              router.refresh()
            }}
          /> : null}
        </section>
      </>}
    </div>
    {inspection && summary && <div className="sticky bottom-0 z-10 space-y-2 border-t bg-background p-4">
      <div className={`flex flex-wrap items-center justify-between gap-2 text-sm ${summary.hasError && inspection.parcels.length ? 'text-red-800' : ''}`}>
        <p>구매수량 <strong>{inspection.expectedQuantity}</strong> · 실제 입고수량 <strong>{summary.receivedQuantity}</strong> · 총 <strong>{summary.boxCount}</strong>박스</p>
        {inspection.parcels.length && summary.hasError ? <p role="status" className="font-semibold">입고오류 · {summary.difference < 0 ? '부족' : '초과'} {Math.abs(summary.difference)}개</p> : summary.quantityPending ? <p>입고수량 미입력</p> : null}
      </div>
      {editable && <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => void save(false)}>임시저장 · 검수로 이동</Button>
        <Button type="button" disabled={pending} onClick={() => void save(true)}>{pending ? '저장 중…' : '검수완료 · 중국창고도착'}</Button>
      </div>}
    </div>}
  </dialog>
}
