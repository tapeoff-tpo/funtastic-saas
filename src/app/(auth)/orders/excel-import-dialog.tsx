'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { bulkUploadInvoiceAction } from './actions'

interface InvoiceImportTemplate {
  id: string
  name: string
  orderIdCol: number
  trackingNumberCol: number
  carrierCol?: number | null
  fixedCarrierId?: string
  description: string
}

const INVOICE_IMPORT_TEMPLATES: InvoiceImportTemplate[] = [
  {
    id: 'cj-invoice-registration',
    name: 'CJ송장등록 양식',
    orderIdCol: 19,
    trackingNumberCol: 8,
    carrierCol: null,
    fixedCarrierId: 'CJGLS',
    description: '고객주문번호 19열, 운송장번호 8열, 택배사 CJ대한통운 고정',
  },
]

interface ExcelImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ParsedResult {
  matched: Array<{
    orderId: string
    orderIdentifier: string
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
  const [templateId, setTemplateId] = useState(INVOICE_IMPORT_TEMPLATES[0].id)
  const [orderIdCol, setOrderIdCol] = useState<number | null>(null)
  const [trackingCol, setTrackingCol] = useState<number | null>(null)
  const [carrierCol, setCarrierCol] = useState<number | null>(null)
  const [result, setResult] = useState<ParsedResult | null>(null)
  const [isParsing, startParsing] = useTransition()
  const [isApplying, startApplying] = useTransition()

  const selectedTemplate = INVOICE_IMPORT_TEMPLATES.find((template) => template.id === templateId)
    ?? INVOICE_IMPORT_TEMPLATES[0]
  const resolvedOrderIdCol = orderIdCol ?? selectedTemplate.orderIdCol
  const resolvedTrackingCol = trackingCol ?? selectedTemplate.trackingNumberCol
  const resolvedCarrierCol = carrierCol ?? selectedTemplate.carrierCol ?? null
  const carrierIsFixed = !!selectedTemplate.fixedCarrierId && !resolvedCarrierCol

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
      formData.append('orderIdCol', String(resolvedOrderIdCol))
      formData.append('trackingNumberCol', String(resolvedTrackingCol))
      formData.append('templateId', selectedTemplate.id)
      if (resolvedCarrierCol) formData.append('carrierCol', String(resolvedCarrierCol))
      if (selectedTemplate.fixedCarrierId) formData.append('fixedCarrierId', selectedTemplate.fixedCarrierId)

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
        setOrderIdCol(null)
        setTrackingCol(null)
        setCarrierCol(null)
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
    setTemplateId(INVOICE_IMPORT_TEMPLATES[0].id)
    setOrderIdCol(null)
    setTrackingCol(null)
    setCarrierCol(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg border bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">엑셀 송장등록</h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="invoice-template" className="mb-1 block text-sm font-medium">
              송장등록 양식
            </label>
            <select
              id="invoice-template"
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value)
                setOrderIdCol(null)
                setTrackingCol(null)
                setCarrierCol(null)
              }}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {INVOICE_IMPORT_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedTemplate.description}
            </p>
          </div>

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
                내부 주문번호 열
              </label>
              <select
                id="order-col"
                value={resolvedOrderIdCol}
                onChange={(e) => setOrderIdCol(Number(e.target.value))}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {Array.from({ length: 40 }, (_, i) => (
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
                value={resolvedTrackingCol}
                onChange={(e) => setTrackingCol(Number(e.target.value))}
                className="w-full rounded-md border px-3 py-2 text-sm"
              >
                {Array.from({ length: 40 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}열
                  </option>
                ))}
              </select>
            </div>
            <div>
              {carrierIsFixed ? (
                <>
                  <span className="mb-1 block text-sm font-medium">택배사</span>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    CJ대한통운 고정
                  </div>
                </>
              ) : (
                <>
                  <label htmlFor="carrier-col" className="mb-1 block text-sm font-medium">
                    택배사 열
                  </label>
                  <select
                    id="carrier-col"
                    value={resolvedCarrierCol ?? 3}
                    onChange={(e) => setCarrierCol(Number(e.target.value))}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  >
                    {Array.from({ length: 40 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {i + 1}열
                      </option>
                    ))}
                  </select>
                </>
              )}
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
                        <th className="px-3 py-1.5 text-left font-medium">내부/주문번호</th>
                        <th className="px-3 py-1.5 text-left font-medium">송장번호</th>
                        <th className="px-3 py-1.5 text-left font-medium">택배사</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.matched.slice(0, 5).map((m) => (
                        <tr key={m.orderId} className="border-t">
                          <td className="px-3 py-1.5 font-mono">{m.orderIdentifier || m.marketplaceOrderId}</td>
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
