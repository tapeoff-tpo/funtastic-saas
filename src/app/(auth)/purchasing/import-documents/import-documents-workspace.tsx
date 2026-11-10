'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ImportDocumentEditor } from './import-document-editor'

export function ImportDocumentsWorkspace({ shipments, selectedShipmentId, invalidSelection }: {
  shipments: Array<{ id: string; label: string }>
  selectedShipmentId: string
  invalidSelection: boolean
}) {
  const router = useRouter()
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
          startTransition(() => router.push(`/purchasing/import-documents?shipment=${encodeURIComponent(id)}`))
        }}>
        <option value="" disabled>출고 건 선택</option>
        {shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.label}</option>)}
      </select>
      {pending && <span className="text-muted-foreground">불러오는 중…</span>}
    </label>
    {invalidSelection && <p role="alert" className="text-sm text-red-700">출고작업을 찾을 수 없습니다.</p>}
    {!shipments.length && <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">등록된 중국출고 요청이 없습니다.</p>}
    {selectedShipmentId && <ImportDocumentEditor shipmentId={selectedShipmentId} onDirtyChange={setDirty} />}
  </div>
}
