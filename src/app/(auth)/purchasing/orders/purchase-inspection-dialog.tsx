'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { blankInspectionBox, inspectionSummary, type InspectionParcel, type PurchaseInspection } from '@/lib/purchasing/purchase-inspection'

type Detail = { id: string; status: string; productName: string; sku: string; inspection: PurchaseInspection; imageUrls: string[] }

export function PurchaseInspectionButton({ id, productName, mode = 'inspection' }: { id: string; productName: string; mode?: 'image' | 'inspection' }) {
  const [open, setOpen] = useState(false)
  return <>
    {mode === 'image' ? <button type="button" data-no-translate title="상품 이미지 보기" className="block w-full truncate text-left font-medium text-blue-700 underline-offset-2 hover:underline" onClick={() => setOpen(true)}>{productName}</button>
      : <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>송장·검수</Button>}
    {open && <InspectionDialog id={id} mode={mode} onClose={() => setOpen(false)} />}
  </>
}

function InspectionDialog({ id, mode, onClose }: { id: string; mode: 'image' | 'inspection'; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [acknowledgeMismatch, setAcknowledgeMismatch] = useState(false)
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
        if (!controller.signal.aborted) { setData(body); setAcknowledgeMismatch(Boolean(body.inspection.checkedAt)); setError(''); setDirty(false) }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '불러오기에 실패했습니다.') }
    })()
    return () => controller.abort()
  }, [id, attempt])

  const inspection = data?.inspection
  const editable = data && ['purchase_completed', 'inspecting'].includes(data.status)
  const summary = inspection ? inspectionSummary(inspection) : null
  function changeParcels(parcels: InspectionParcel[]) {
    setData((current) => current ? { ...current, inspection: { ...current.inspection, parcels, checkedAt: null } } : current)
    setDirty(true); setAcknowledgeMismatch(false)
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
      <div className="flex items-center justify-between gap-3"><h2 id="purchase-inspection-title" className="text-lg font-semibold">{mode === 'image' ? '상품 이미지' : '송장·검수'}</h2><Button type="button" variant="outline" disabled={pending} onClick={close}>닫기</Button></div>
      {data && <p className="mt-2 text-sm" data-no-translate>{data.sku} · {data.productName}</p>}
    </div>
    <div className="space-y-4 p-4">
      {error ? <div role="alert" className="text-sm text-red-700">{error}<Button type="button" variant="outline" className="ml-3" onClick={() => setAttempt((value) => value + 1)}>다시 불러오기</Button></div> : !data ? <p>불러오는 중…</p> : null}
      {data && mode === 'image' && <div className="grid gap-4 sm:grid-cols-2">
        {data.imageUrls.length ? data.imageUrls.map((url) => <div key={url} className="rounded-lg border p-2">
          {/* Product images come from the authenticated item master and may use external hosts. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={data.productName} className="max-h-[65dvh] w-full object-contain" />
        </div>) : <p className="text-sm text-muted-foreground">등록된 상품 이미지가 없습니다.</p>}
      </div>}
      {data && mode === 'inspection' && inspection && summary && <>
        <div className={`rounded-lg border p-3 text-sm ${summary.hasError && inspection.parcels.length ? 'border-red-300 bg-red-50 text-red-800' : 'bg-muted/30'}`}>
          <p>구매수량 <strong>{inspection.expectedQuantity}</strong> · 실제 입고수량 <strong>{summary.receivedQuantity}</strong> · 총 <strong>{summary.boxCount}</strong>박스</p>
          {inspection.parcels.length && summary.hasError ? <p role="status" className="mt-1 font-semibold">입고오류 · {summary.difference < 0 ? '부족' : '초과'} {Math.abs(summary.difference)}개</p> : summary.quantityPending ? <p className="mt-1">입고수량 미입력</p> : null}
        </div>
        <fieldset disabled={pending || !editable} className="space-y-4">
          {inspection.parcels.map((parcel, parcelIndex) => <section key={parcel.id} className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1 text-sm">송장번호<input aria-label={`송장번호 ${parcelIndex + 1}`} value={parcel.trackingNumber} maxLength={100} className="mt-1 block w-full rounded border bg-background p-2"
                onChange={(event) => changeParcels(inspection.parcels.map((row) => row.id === parcel.id ? { ...row, trackingNumber: event.target.value } : row))} /></label>
              <span className="pb-2 text-sm">송장별 입고수량: <strong>{parcel.boxes.reduce((sum, box) => sum + (box.quantity ?? 0), 0)}</strong>개</span>
              {parcel.trackingNumber && <a href={`https://www.baidu.com/s?wd=${encodeURIComponent(parcel.trackingNumber)}`} target="_blank" rel="noreferrer" className="pb-2 text-sm text-blue-700 underline">송장 조회</a>}
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
          {summary.hasError && inspection.parcels.length > 0 && <div className="space-y-2 rounded-lg border border-red-200 p-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={acknowledgeMismatch} onChange={(event) => setAcknowledgeMismatch(event.target.checked)} />구매수량과 실제 입고수량의 차이를 확인했습니다.</label>
            <label className="block text-sm">입고오류 처리 사유<textarea value={inspection.resolutionNote} maxLength={2_000} className="mt-1 block w-full rounded border bg-background p-2" onChange={(event) => { setData({ ...data, inspection: { ...inspection, resolutionNote: event.target.value } }); setDirty(true) }} /></label>
          </div>}
        </fieldset>
        {!editable && <p className="text-sm text-muted-foreground">검수가 완료된 입고 기록입니다.</p>}
      </>}
    </div>
    {mode === 'inspection' && data && editable && <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background p-4">
      <Button type="button" variant="outline" disabled={pending} onClick={() => void save(false)}>임시저장 · 검수로 이동</Button>
      <Button type="button" disabled={pending} onClick={() => void save(true)}>{pending ? '저장 중…' : '검수완료 · 중국창고도착'}</Button>
    </div>}
  </dialog>
}
