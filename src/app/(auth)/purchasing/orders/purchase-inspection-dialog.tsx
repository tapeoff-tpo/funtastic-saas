'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { PurchasingProductImageButton } from '@/components/purchasing-product-image'
import type { ProductImageResult } from '@/lib/purchasing/product-image-catalogue'
import { Button } from '@/components/ui/button'
import { blankInspectionBox, inspectionSummary, type InspectionParcel, type PurchaseInspection } from '@/lib/purchasing/purchase-inspection'

type Detail = { id: string; status: string; productName: string; sku: string; inspection: PurchaseInspection; imageUrls: string[] }

function withSingleParcelQuantityDefault(detail: Detail) {
  const inspection = detail.inspection
  const [parcel] = inspection.parcels
  const [box] = parcel?.boxes ?? []
  const editable = detail.status === 'purchase_completed' || detail.status === 'inspecting'
  if (!editable || inspection.parcels.length !== 1 || !parcel || parcel.boxes.length !== 1 || !box || box.quantity !== null) {
    return { detail, prefilled: false }
  }

  return {
    detail: {
      ...detail,
      inspection: {
        ...inspection,
        parcels: [{
          ...parcel,
          boxes: [{ ...box, quantity: inspection.expectedQuantity }],
        }],
      },
    },
    prefilled: true,
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
  const [quantityPrefilled, setQuantityPrefilled] = useState(false)
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
          setData(initial.detail)
          setQuantityPrefilled(initial.prefilled)
          setAcknowledgeMismatch(Boolean(initial.detail.inspection.checkedAt))
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
  function changeParcels(parcels: InspectionParcel[]) {
    setData((current) => current ? { ...current, inspection: { ...current.inspection, parcels, checkedAt: null } } : current)
    setDirty(true); setQuantityPrefilled(false); setAcknowledgeMismatch(false)
  }
  function close() {
    if (dirty && !confirm('저장하지 않은 검수 입력을 닫으시겠습니까?')) return
    ref.current?.close()
  }
  async function save(complete: boolean) {
    if (!data || !inspection) return
    setPending(true)
    try {
      const response = await fetch(`/api/purchasing/purchase-requests/${id}/inspection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: inspection.revision, parcels: inspection.parcels, complete, acknowledgeMismatch, resolutionNote: inspection.resolutionNote }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '검수 저장에 실패했습니다.')
      setData((current) => current ? { ...current, status: 'inspecting', inspection: body.inspection } : current)
      setDirty(false); setQuantityPrefilled(false)
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
      {data && <p className="mt-2 text-sm" data-no-translate>{data.sku} · {data.productName}</p>}
    </div>
    <div className="space-y-4 p-4">
      {error ? <div role="alert" className="text-sm text-red-700">{error}<Button type="button" variant="outline" className="ml-3" onClick={() => setAttempt((value) => value + 1)}>다시 불러오기</Button></div> : !data ? <p>불러오는 중…</p> : null}
      {data && inspection && summary && <>
        <div className={`rounded-lg border p-3 text-sm ${summary.hasError && inspection.parcels.length ? 'border-red-300 bg-red-50 text-red-800' : 'bg-muted/30'}`}>
          <p>구매수량 <strong>{inspection.expectedQuantity}</strong> · 실제 입고수량 <strong>{summary.receivedQuantity}</strong> · 총 <strong>{summary.boxCount}</strong>박스</p>
          {inspection.parcels.length && summary.hasError ? <p role="status" className="mt-1 font-semibold">입고오류 · {summary.difference < 0 ? '부족' : '초과'} {Math.abs(summary.difference)}개</p> : summary.quantityPending ? <p className="mt-1">입고수량 미입력</p> : null}
          {quantityPrefilled ? <p className="mt-1 text-muted-foreground">구매완료 수량을 임시 기본값으로 넣었습니다. 실제 입고수량을 확인한 뒤 저장하세요.</p> : null}
        </div>
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
                <td><Button type="button" variant="ghost" size="sm" disabled={parcel.boxes.length === 1} onClick={() => changeParcels(inspection.parcels.map((row) => row.id === parcel.id ? { ...row, boxes: row.boxes.filter((entry) => entry.id !== box.id) } : row))}>삭제</Button></td>
              </tr>)}</tbody>
            </table></div>
            <Button type="button" variant="outline" size="sm" onClick={() => changeParcels(inspection.parcels.map((row) => row.id === parcel.id ? { ...row, boxes: [...row.boxes, blankInspectionBox(crypto.randomUUID())] } : row))}>박스 추가</Button>
          </section>)}
          <Button type="button" variant="outline" onClick={() => changeParcels([...inspection.parcels, { id: crypto.randomUUID(), trackingNumber: '', boxes: [blankInspectionBox(crypto.randomUUID())] }])}>송장 추가</Button>
          {inspection.parcels.length > 0 && <div className={`space-y-2 rounded-lg border p-3 ${summary.hasError ? 'border-red-200 bg-red-50/50' : 'bg-muted/20'}`}>
            {summary.hasError ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acknowledgeMismatch} onChange={(event) => setAcknowledgeMismatch(event.target.checked)} />구매수량과 실제 입고수량의 차이를 확인했습니다.</label> : <p className="text-sm text-muted-foreground">실제 입고수량이 구매수량과 다르면 아래 비고를 입력해주세요.</p>}
            <label className="block text-sm">수량 차이 비고<textarea value={inspection.resolutionNote} maxLength={2_000} placeholder="예: 공급처 출고 누락 10개, 다음 출고에 보충 예정" className="mt-1 block w-full rounded border bg-background p-2" onChange={(event) => { setData({ ...data, inspection: { ...inspection, resolutionNote: event.target.value } }); setDirty(true) }} /></label>
            {summary.hasError ? <p className="text-xs text-red-700">수량이 다르면 확인 체크와 비고 입력 후에만 검수완료할 수 있습니다.</p> : null}
          </div>}
        </fieldset>
        {!editable && <p className="text-sm text-muted-foreground">검수가 완료된 입고 기록입니다.</p>}
      </>}
    </div>
    {data && editable && <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background p-4">
      <Button type="button" variant="outline" disabled={pending} onClick={() => void save(false)}>임시저장 · 검수로 이동</Button>
      <Button type="button" disabled={pending} onClick={() => void save(true)}>{pending ? '저장 중…' : '검수완료 · 중국창고도착'}</Button>
    </div>}
  </dialog>
}
