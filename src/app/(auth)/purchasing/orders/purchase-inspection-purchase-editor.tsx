'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { PurchaseInspection } from '@/lib/purchasing/purchase-inspection'
import type { PurchaseInspectionIssue } from '@/lib/purchasing/purchase-inspection-issues'
import { PurchasePlanFieldsV2 } from './purchase-request-actions'

export type InspectionPurchaseFields = {
  requestedQuantity: number
  actualPurchaseQuantity: number | null
  supplierOrderNumber: string | null
  outboundExpectedDate: string | null
  purchaseMethod: string | null
}

export function PurchaseInspectionPurchaseEditor({
  purchaseItemId, status, inspection, issues, purchaseFields, onCorrected,
}: {
  purchaseItemId: string
  status: string
  inspection: PurchaseInspection
  issues: PurchaseInspectionIssue[]
  purchaseFields: InspectionPurchaseFields
  onCorrected: (saved: { actualPurchaseQuantity: number; inspection: PurchaseInspection }) => void
}) {
  const router = useRouter()
  const [quantity, setQuantity] = useState(String(purchaseFields.actualPurchaseQuantity ?? inspection.expectedQuantity))
  const [issueId, setIssueId] = useState(issues.at(-1)?.id ?? '')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const canCorrectQuantity = ['purchase_completed', 'inspecting'].includes(status)

  async function correct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const actualPurchaseQuantity = Number(quantity)
    if (quantity.trim() === '' || !Number.isInteger(actualPurchaseQuantity) || actualPurchaseQuantity < 0 || actualPurchaseQuantity > 1_000_000) {
      toast.error('정정할 구매수량을 확인해주세요.')
      return
    }
    if (!reason.trim() || !issueId) {
      toast.error('관련 검수 오류와 구매수량 정정 사유를 입력해주세요.')
      return
    }
    setPending(true)
    try {
      const response = await fetch(`/api/purchasing/purchase-requests/${purchaseItemId}/inspection/correction`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId, actualPurchaseQuantity, reason: reason.trim(), expectedRevision: inspection.revision }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? '구매수량 정정에 실패했습니다.')
      onCorrected(body)
      setReason('')
      toast.success('구매수량을 정정했습니다. 송장·검수에서 다시 검수를 완료해주세요.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '구매수량 정정에 실패했습니다.')
    } finally {
      setPending(false)
    }
  }

  return <section className="mt-4 space-y-3 rounded-lg border p-3">
    <h3 className="text-sm font-semibold">구매 정보 수정</h3>
    <div className="overflow-x-auto pb-1">
      <PurchasePlanFieldsV2
        id={purchaseItemId} supplierOrderNumber={purchaseFields.supplierOrderNumber}
        trackingNumber={null} showTrackingNumber={false}
        dateValue={purchaseFields.outboundExpectedDate} dateField="outboundExpectedDate" dateLabel="구매날짜"
        purchaseMethod={purchaseFields.purchaseMethod}
      />
    </div>
    {canCorrectQuantity ? <form onSubmit={(event) => void correct(event)} className="space-y-3 border-t pt-3">
      <h4 className="text-sm font-semibold">구매수량 정정</h4>
      <p className="text-xs text-muted-foreground">박스별 실제 입고수량은 보존되며, 정정 후 송장·검수에서 다시 검수를 완료해야 합니다.</p>
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">관련 검수 오류
          <select value={issueId} onChange={(event) => setIssueId(event.target.value)} required className="block w-full rounded border bg-background p-2 text-sm" data-no-translate>
            {issues.map((issue, index) => <option key={issue.id} value={issue.id}>{index + 1}. {issue.description.slice(0, 80)}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">정정 구매수량
          <input type="number" min={0} max={1_000_000} step={1} required value={quantity} onChange={(event) => setQuantity(event.target.value)} className="block w-full rounded border bg-background p-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">구매수량 정정 사유
          <textarea required maxLength={2_000} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} className="block w-full rounded border bg-background p-2 text-sm" />
        </label>
      </fieldset>
      <div className="flex justify-end"><Button type="submit" variant="outline" disabled={pending}>{pending ? '저장 중…' : '구매수량 정정 저장'}</Button></div>
    </form> : <p className="text-xs text-muted-foreground">중국창고도착 이후에는 구매수량을 정정할 수 없습니다.</p>}
  </section>
}
