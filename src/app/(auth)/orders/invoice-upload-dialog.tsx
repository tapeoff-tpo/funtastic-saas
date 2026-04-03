'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CARRIERS } from '@/lib/shipping/carrier-codes'
import { uploadInvoiceAction, bulkUploadInvoiceAction } from './actions'

interface InvoiceUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedOrderIds: string[]
}

/**
 * Dialog for entering tracking number and selecting carrier.
 * Supports single and bulk invoice upload via server actions.
 */
export function InvoiceUploadDialog({
  open,
  onOpenChange,
  selectedOrderIds,
}: InvoiceUploadDialogProps) {
  const [trackingNumber, setTrackingNumber] = useState('')
  const [carrierId, setCarrierId] = useState('CJGLS')
  const [isPending, startTransition] = useTransition()

  if (!open) return null

  const orderCount = selectedOrderIds.length

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!trackingNumber.trim()) {
      toast.error('송장번호를 입력해주세요')
      return
    }

    startTransition(async () => {
      if (orderCount === 1) {
        const result = await uploadInvoiceAction(
          selectedOrderIds[0],
          trackingNumber.trim(),
          carrierId,
        )
        if (result.success) {
          toast.success('송장 업로드가 대기열에 추가되었습니다')
          onOpenChange(false)
          setTrackingNumber('')
        } else {
          toast.error(result.error ?? '송장 업로드에 실패했습니다')
        }
      } else {
        const orders = selectedOrderIds.map((id) => ({
          orderId: id,
          trackingNumber: trackingNumber.trim(),
          carrierId,
        }))
        const result = await bulkUploadInvoiceAction(orders)
        if (result.errors.length === 0) {
          toast.success(`${result.queued}건의 송장이 대기열에 추가되었습니다`)
          onOpenChange(false)
          setTrackingNumber('')
        } else {
          toast.warning(
            `${result.queued}건 성공, ${result.errors.length}건 실패`,
          )
        }
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">송장업로드</h2>

        {orderCount > 1 && (
          <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
            {orderCount}건 주문에 동일 송장 적용 (합포장)
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="carrier" className="mb-1 block text-sm font-medium">
              택배사
            </label>
            <select
              id="carrier"
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {CARRIERS.map((carrier) => (
                <option key={carrier.code} value={carrier.code}>
                  {carrier.koreanName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="trackingNumber" className="mb-1 block text-sm font-medium">
              송장번호
            </label>
            <input
              id="trackingNumber"
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="송장번호를 입력하세요"
              className="w-full rounded-md border px-3 py-2 text-sm"
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isPending || !trackingNumber.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? '처리중...' : '업로드'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
