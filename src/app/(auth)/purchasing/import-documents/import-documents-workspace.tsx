'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { KoreaShippingDocumentPanel } from './korea-shipping-document-panel'
import { ImportDocumentEditor } from './import-document-editor'

export function ImportDocumentsWorkspace({ shipments, selectedShipmentId, invalidSelection, mode = 'document' }: {
  shipments: Array<{ id: string; label: string }>
  selectedShipmentId: string
  invalidSelection: boolean
  mode?: 'document' | 'cost'
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const document = searchParams.get('document') === 'korea' ? 'korea' : 'invoice'
  const group = searchParams.get('group') === 'box' ? 'box' : 'pallet'
  function updateView(values: Record<string, string>) {
    const params = new URLSearchParams(window.location.search)
    Object.entries(values).forEach(([key, value]) => params.set(key, value))
    window.history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`)
  }
  const [dirty, setDirty] = useState(false)
  const [pending, startTransition] = useTransition()

  return <div className="min-w-0 space-y-4">
    <label className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-4 text-sm font-medium">
      중국출고 선택
      <select value={selectedShipmentId} disabled={pending || !shipments.length}
        className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm sm:max-w-2xl"
        onChange={(event) => {
          const id = event.target.value
          if (dirty && !window.confirm('입력한 문서 내용을 닫고 다른 출고 건으로 이동할까요?')) return
          const params = new URLSearchParams(searchParams.toString())
          params.set('shipment', id)
          startTransition(() => router.push(`${mode === 'cost' ? '/purchasing/import-documents/costs' : '/purchasing/import-documents'}?${params}`))
        }}>
        <option value="" disabled>출고 건 선택</option>
        {shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.label}</option>)}
      </select>
      {pending && <span className="text-muted-foreground">불러오는 중…</span>}
    </label>
    {invalidSelection && <p role="alert" className="text-sm text-red-700">출고작업을 찾을 수 없습니다.</p>}
    {!shipments.length && <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">등록된 중국출고 요청이 없습니다.</p>}
    {mode === 'document' && <div role="tablist" aria-label="무역서류 종류" className="flex gap-2 border-b">{[['invoice', '인보이스·패킹리스트'], ['korea', '한국 출고서류']].map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={document === key} onClick={() => { if (dirty && !window.confirm('저장하지 않은 내용을 닫고 이동할까요?')) return; setDirty(false); updateView({ document: key }) }} className={`px-4 py-2 text-sm ${document === key ? 'border-b-2 border-primary font-semibold' : 'text-muted-foreground'}`}>{label}</button>)}</div>}
    {selectedShipmentId && (mode === 'document' && document === 'korea' ? <KoreaShippingDocumentPanel shipmentId={selectedShipmentId} group={group} onGroupChange={(value) => updateView({ group: value })} /> : <ImportDocumentEditor mode={mode} shipmentId={selectedShipmentId} onDirtyChange={setDirty} />)}
  </div>
}
