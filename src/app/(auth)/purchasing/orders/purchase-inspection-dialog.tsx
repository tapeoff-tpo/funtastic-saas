'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, ExternalLink } from 'lucide-react'
import { PurchasingProductImageButton } from '@/components/purchasing-product-image'
import type { ProductImageResult } from '@/lib/purchasing/product-image-catalogue'
import { Button } from '@/components/ui/button'
import { blankInspectionBox, inspectionSummary, validateInspectionSave, type InspectionParcel, type PurchaseInspection } from '@/lib/purchasing/purchase-inspection'
import type { InspectionLabelFile, InspectionPrintRequest } from '@/lib/purchasing/purchase-inspection-label-types'
import type { PurchaseInspectionIssue } from '@/lib/purchasing/purchase-inspection-issues'
import { PurchaseInspectionIssueList, PurchaseInspectionIssueRegister } from './purchase-inspection-issues'
import { PurchaseInspectionLabelPanel } from './purchase-inspection-label-panel'

type Detail = { id: string; status: string; productName: string; sku: string; inspection: PurchaseInspection; inspectionIssues?: PurchaseInspectionIssue[]; printRequests?: InspectionPrintRequest[]; imageUrls: string[] }

const printRequestDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const printRequestNames = { box: '박스 스티커', quality: '품질표시사항', barcode: '바코드 스티커' }

function formatPrintRequest(entry: InspectionPrintRequest) {
  return `${printRequestNames[entry.kind]} · ${printRequestDate.format(new Date(entry.requestedAt))} · ${entry.actorName}`
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
  const quantityReasonRef = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [acknowledgeMismatch, setAcknowledgeMismatch] = useState(false)
  const [printHistoryError, setPrintHistoryError] = useState('')
  const [boxNumberError, setBoxNumberError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [attempt, setAttempt] = useState(0)
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
  function changeParcels(parcels: InspectionParcel[]) {
    setData((current) => current ? { ...current, inspection: { ...current.inspection, parcels, checkedAt: null } } : current)
    setDirty(true); setAcknowledgeMismatch(false)
  }
  function copyFirstBox(parcel: InspectionParcel) {
    const firstBox = parcel.boxes[0]
    if (!inspection || !firstBox || remainingBoxCapacity < 1) return
    const copy = { ...firstBox, id: crypto.randomUUID() }
    changeParcels(inspection.parcels.map((row) => row.id === parcel.id
      ? { ...row, boxes: [...row.boxes, copy] }
      : row))
  }
  function close() {
    if (dirty && !confirm('저장하지 않은 검수 입력을 닫으시겠습니까?')) return
    ref.current?.close()
  }
  async function save(complete: boolean) {
    if (!data || !inspection) return
    try {
      validateInspectionSave(inspection)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : '검수 저장에 실패했습니다.')
      quantityReasonRef.current?.focus()
      return
    }
    setPending(true)
    try {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}/inspection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: inspection.revision, parcels: inspection.parcels, complete, acknowledgeMismatch, resolutionNote: inspection.resolutionNote }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '검수 저장에 실패했습니다.')
      setData((current) => current ? { ...current, status: body.status ?? 'inspecting', inspection: body.inspection } : current)
      setDirty(false)
      setBoxNumberError('')
      if (complete) {
        toast.success('검수를 완료하고 중국창고도착으로 이동했습니다.')
        ref.current?.close()
      } else toast.success('송장·박스를 임시저장했습니다.')
      router.refresh()
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : '검수 저장에 실패했습니다.') }
    finally { setPending(false) }
  }

  const savedBoxes = inspection?.parcels.flatMap((parcel) => parcel.boxes) ?? []
  const needsBoxNumbers = savedBoxes.some((box) => !inspection?.boxNumbers?.[box.id])

  async function recordPrint(file?: InspectionLabelFile) {
    setPrintHistoryError('')
    const target = file ? { kind: 'file', fileId: file.id, source: file.source } : { kind: 'box' }
    try {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}/inspection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ action: 'record-print', ...target }),
      })
      const result = await response.json()
      if (!response.ok || !result.entry) throw new Error(result.error || '인쇄 요청 이력을 저장하지 못했습니다.')
      const entry = result.entry as InspectionPrintRequest
      setData((current) => current ? {
        ...current,
        printRequests: [entry, ...(current.printRequests ?? [])].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, 100),
      } : current)
    } catch {
      setPrintHistoryError('인쇄 요청 이력을 저장하지 못했습니다.')
    }
  }

  async function issueBoxNumbers() {
    if (dirty || pending) return
    setBoxNumberError('')
    setPending(true)
    try {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}/inspection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'issue-box-numbers' }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.inspection) throw new Error(body?.error || '박스번호 발급에 실패했습니다. 다시 시도해주세요.')
      setData((current) => current ? { ...current, inspection: body.inspection } : current)
      toast.success('검수 박스번호를 발급했습니다.')
    } catch (error) {
      setBoxNumberError(error instanceof Error ? error.message : '박스번호 발급에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  return <dialog ref={ref} aria-labelledby="purchase-inspection-title" onClose={onClose}
    onCancel={(event) => { event.preventDefault(); if (!pending) close() }}
    className="fixed inset-0 m-auto max-h-[92dvh] w-[min(64rem,96vw)] rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40">
    <div className="sticky top-0 z-10 border-b bg-background p-4">
      <div className="flex items-center justify-between gap-3"><h2 id="purchase-inspection-title" className="text-lg font-semibold">송장·검수</h2><Button type="button" variant="outline" disabled={pending} onClick={close}>닫기</Button></div>
      {data && inspection && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p data-no-translate>{data.sku} · {data.productName}</p>
      </div>}
    </div>
    <div className="space-y-4 p-4">
      {error ? <div role="alert" className="text-sm text-red-700">{error}<Button type="button" variant="outline" className="ml-3" onClick={() => setAttempt((value) => value + 1)}>다시 불러오기</Button></div> : !data ? <p>불러오는 중…</p> : null}
      {data && inspection && summary && <>
        <PurchaseInspectionLabelPanel id={id} canUpload={editable || data.status === 'china_arrived'} onPrint={recordPrint} />
        <fieldset disabled={pending || !editable} className="min-w-0 space-y-4">
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
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" aria-label={`${parcelIndex + 1}번 송장 박스 복사`}
                  disabled={remainingBoxCapacity < 1 || !parcel.boxes.length}
                  title="첫 번째 박스를 같은 송장에 1개 추가"
                  onClick={() => copyFirstBox(parcel)}><Copy className="size-3.5" />박스 복사</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => changeParcels(inspection.parcels.filter((row) => row.id !== parcel.id))}>송장 삭제</Button>
              </div>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-sm">
              <thead><tr>{['박스번호', '입고수량', '가로(cm)', '세로(cm)', '높이(cm)', '무게(kg)', 'CBM', ''].map((text, index) => <th key={index} className="p-1 text-left font-medium">{text}</th>)}</tr></thead>
              <tbody>{parcel.boxes.map((box, boxIndex) => <tr key={box.id}>
                <td className="whitespace-nowrap p-1 font-mono">{inspection.boxNumbers?.[box.id] ?? '미발급'}</td>
                {(['quantity', 'lengthCm', 'widthCm', 'heightCm', 'weightKg'] as const).map((field) => <td key={field} className="p-1">
                  <input type="number" aria-label={`${parcelIndex + 1}번 송장 ${boxIndex + 1}번 박스 ${field}`} min={field === 'quantity' ? 0 : 0.001} step={field === 'quantity' ? 1 : 'any'} value={box[field] ?? ''} className="w-24 rounded border bg-background p-1.5"
                    onChange={(event) => { const value = event.target.value === '' ? null : Number(event.target.value); changeParcels(inspection.parcels.map((row) => row.id === parcel.id ? { ...row, boxes: row.boxes.map((entry) => entry.id === box.id ? { ...entry, [field]: value } : entry) } : row)) }} />
                </td>)}
                <td className="p-1 tabular-nums">{box.lengthCm && box.widthCm && box.heightCm ? (box.lengthCm * box.widthCm * box.heightCm / 1_000_000).toFixed(6) : '—'}</td>
                <td className="p-1">
                  <Button type="button" variant="ghost" size="sm" disabled={parcel.boxes.length === 1}
                    onClick={() => changeParcels(inspection.parcels.map((row) => row.id === parcel.id
                      ? { ...row, boxes: row.boxes.filter((entry) => entry.id !== box.id) }
                      : row))}>박스 삭제</Button>
                </td>
              </tr>)}</tbody>
            </table></div>
          </section>)}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={remainingBoxCapacity < 1 || inspection.parcels.length >= 100} title={remainingBoxCapacity < 1 ? '검수 한 건에는 박스를 최대 500개까지 입력할 수 있습니다.' : undefined} onClick={() => changeParcels([...inspection.parcels, { id: crypto.randomUUID(), trackingNumber: '', boxes: [blankInspectionBox(crypto.randomUUID())] }])}>새 송장 추가</Button>
          </div>
          {((inspection.parcels.length > 0 && summary.hasError) || inspection.resolutionNote) && <div className={`space-y-2 rounded-lg border p-3 ${summary.hasError ? 'border-red-200 bg-red-50/50' : 'bg-muted/20'}`}>
            {editable && summary.hasError && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acknowledgeMismatch} onChange={(event) => setAcknowledgeMismatch(event.target.checked)} />구매수량과 실제 입고수량의 차이를 확인했습니다.</label>}
            <p className="text-xs text-muted-foreground">구매수량과 실제 입고수량이 다르면 임시저장할 때도 오류 설명을 입력해주세요.</p>
            <label className="block text-sm">수량 차이 오류 설명<textarea ref={quantityReasonRef} aria-label="수량 차이 오류 설명" aria-required={summary.hasError} value={inspection.resolutionNote} maxLength={2_000} placeholder="예: 공급처 출고 누락 10개, 다음 출고에 보충 예정" className="mt-1 block w-full rounded border bg-background p-2" onChange={(event) => { setData({ ...data, inspection: { ...inspection, resolutionNote: event.target.value } }); setDirty(true) }} /></label>
          </div>}
        </fieldset>
        {!!data.inspectionIssues?.length && <section className="space-y-3 rounded-lg border p-3">
          <div>
            <h3 className="text-sm font-semibold">등록된 검수 오류</h3>
            <p className="mt-1 text-xs text-muted-foreground">구매 담당자는 구매 목록의 구매 정보에서 내용을 수정한 뒤 저장할 수 있습니다.</p>
          </div>
          <PurchaseInspectionIssueList purchaseItemId={id} issues={data.inspectionIssues} />
        </section>}
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
      </>}
    </div>
    {inspection && summary && <div className="sticky bottom-0 z-10 space-y-2 border-t bg-background p-4">
      <div className={`flex flex-wrap items-center justify-between gap-2 text-sm ${summary.hasError && inspection.parcels.length ? 'text-red-800' : ''}`}>
        <p>구매수량 <strong>{inspection.expectedQuantity}</strong> · 실제 입고수량 <strong>{summary.receivedQuantity}</strong> · 총 <strong>{summary.boxCount}</strong>박스</p>
        {inspection.parcels.length && summary.hasError ? <p role="status" className="font-semibold">입고오류 · {summary.difference < 0 ? '부족' : '초과'} {Math.abs(summary.difference)}개</p> : summary.quantityPending ? <p>입고수량 미입력</p> : null}
      </div>
      {printHistoryError && <p role="alert" className="text-xs text-red-700">{printHistoryError}</p>}
      {!!data?.printRequests?.length && <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">최근 인쇄 요청 · {formatPrintRequest(data.printRequests[0]!)}</summary>
        <ol className="mt-2 max-h-32 space-y-1 overflow-y-auto">
          {data.printRequests.map((entry) => <li key={entry.id}>
            {formatPrintRequest(entry)}{entry.boxNumbers?.length ? ` · ${entry.boxNumbers.join(', ')}` : entry.fileName ? ` · ${entry.fileName}` : ''}
          </li>)}
        </ol>
      </details>}
      {boxNumberError && <p role="alert" className="text-sm text-red-700">{boxNumberError}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editable && <Button type="button" variant="outline" disabled={pending} onClick={() => void save(false)}>임시저장</Button>}
        {inspection.revision > 0 && savedBoxes.length > 0 && <>
          {needsBoxNumbers ? (
            <Button type="button" variant="outline" disabled={pending || dirty} onClick={issueBoxNumbers}>박스번호 발급</Button>
          ) : <span className="text-sm text-muted-foreground">박스번호 발급 완료</span>}
          <Button type="button" variant="outline" disabled={pending || dirty || needsBoxNumbers}
            onClick={() => {
              window.open(`/api/purchasing/purchase-requests/${id}/inspection?format=box-print`, '_blank', 'noopener,noreferrer')
              void recordPrint()
            }}>박스 스티커 인쇄</Button>
        </>}
        {editable && <Button type="button" disabled={pending} onClick={() => void save(true)}>{pending ? '처리 중…' : '검수완료'}</Button>}
      </div>
    </div>}
  </dialog>
}
