'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { bulkUploadInvoiceAction } from './actions'

interface ExcelImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ParsedResult {
  matched: Array<{
    orderId: string
    marketplaceOrderId: string
    trackingNumber: string
    carrierId?: string
  }>
  unmatched: Array<{
    orderIdentifier: string
    trackingNumber: string
    carrierId?: string
  }>
  invalid: Array<{
    row: number
    errors: string[]
  }>
}

/**
 * Dialog for uploading Excel files with invoice data.
 * Supports column mapping, preview, and bulk apply.
 */
export function ExcelImportDialog({
  open,
  onOpenChange,
}: ExcelImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [orderIdCol, setOrderIdCol] = useState(1)
  const [trackingCol, setTrackingCol] = useState(2)
  const [carrierCol, setCarrierCol] = useState(3)
  const [result, setResult] = useState<ParsedResult | null>(null)
  const [isParsing, startParsing] = useTransition()
  const [isApplying, startApplying] = useTransition()

  if (!open) return null

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    setResult(null)
  }

  const handleParse = () => {
    if (!file) return

    startParsing(async () => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('orderIdCol', String(orderIdCol))
      formData.append('trackingNumberCol', String(trackingCol))
      formData.append('carrierCol', String(carrierCol))

      const res = await fetch('/api/shipping/import', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        toast.error('엑셀 파일 처리에 실패했습니다')
        return
      }

      const data = await res.json() as ParsedResult
      setResult(data)

      if (data.matched.length === 0 && data.unmatched.length === 0 && data.invalid.length === 0) {
        toast.warning('데이터를 찾을 수 없습니다')
      }
    })
  }

  const handleApply = () => {
    if (!result || result.matched.length === 0) return

    startApplying(async () => {
      const orders = result.matched.map((m) => ({
        orderId: m.orderId,
        trackingNumber: m.trackingNumber,
        carrierId: m.carrierId ?? 'CJGLS',
      }))

      const uploadResult = await bulkUploadInvoiceAction(orders)

      if (uploadResult.errors.length === 0) {
        toast.success(`${uploadResult.queued}건의 송장이 대기열에 추가되었습니다`)
        onOpenChange(false)
        setFile(null)
        setResult(null)
      } else {
        toast.warning(
          `${uploadResult.queued}건 성공, ${uploadResult.errors.length}건 실패`,
        )
      }
    })
  }

  const handleClose = () => {
    onOpenChange(false)
    setFile(null)
    setResult(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg border bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">엑셀 송장등록</h2>

        <div className="space-y-4">
          {/* File input */}
          <div>
            <label htmlFor="excel-file" className="mb-1 block text-sm font-medium">
              엑셀 파일
            </label>
            <input
              id="excel-file"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          {/* Column mapping */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="order-col" className="mb-1 block text-sm font-medium">
                마켓 주문번호 열
              </label>
              <select
                id="order-col"
                value={orderIdCol}
                onChange={(e) => setOrderIdCol(Number(e.target.value))}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {Array.from({ length: 20 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}열
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tracking-col" className="mb-1 block text-sm font-medium">
                송장번호 열
              </label>
              <select
                id="tracking-col"
                value={trackingCol}
                onChange={(e) => setTrackingCol(Number(e.target.value))}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {Array.from({ length: 20 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}열
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="carrier-col" className="mb-1 block text-sm font-medium">
                택배사 열
              </label>
              <select
                id="carrier-col"
                value={carrierCol}
                onChange={(e) => setCarrierCol(Number(e.target.value))}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {Array.from({ length: 20 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}열
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Parse button */}
          <button
            type="button"
            onClick={handleParse}
            disabled={!file || isParsing}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isParsing ? '분석중...' : '파일 분석'}
          </button>

          {/* Results */}
          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-md bg-green-50 p-2 text-center text-green-700">
                  매칭: {result.matched.length}건
                </div>
                <div className="rounded-md bg-yellow-50 p-2 text-center text-yellow-700">
                  미매칭: {result.unmatched.length}건
                </div>
                <div className="rounded-md bg-red-50 p-2 text-center text-red-700">
                  오류: {result.invalid.length}건
                </div>
              </div>

              {/* Preview matched rows (first 5) */}
              {result.matched.length > 0 && (
                <div className="max-h-48 overflow-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">마켓 주문번호</th>
                        <th className="px-3 py-1.5 text-left font-medium">송장번호</th>
                        <th className="px-3 py-1.5 text-left font-medium">택배사</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.matched.slice(0, 5).map((m) => (
                        <tr key={m.orderId} className="border-t">
                          <td className="px-3 py-1.5 font-mono">{m.marketplaceOrderId}</td>
                          <td className="px-3 py-1.5">{m.trackingNumber}</td>
                          <td className="px-3 py-1.5">{m.carrierId ?? '-'}</td>
                        </tr>
                      ))}
                      {result.matched.length > 5 && (
                        <tr className="border-t">
                          <td colSpan={3} className="px-3 py-1.5 text-center text-muted-foreground">
                            ... 외 {result.matched.length - 5}건
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
            >
              닫기
            </button>
            {result && result.matched.length > 0 && (
              <button
                type="button"
                onClick={handleApply}
                disabled={isApplying}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isApplying ? '적용중...' : `${result.matched.length}건 적용`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
