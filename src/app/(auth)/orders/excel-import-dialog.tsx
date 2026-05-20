'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { bulkUploadInvoiceAction } from './actions'

const CARRIER_LABELS: Record<string, string> = {
  CJGLS: 'CJ대한통운',
  KDEXP: '경동택배',
  DAESIN: '대신택배',
}

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
  {
    id: 'kyungdong-invoice-registration',
    name: '경동택배 송장등록 양식',
    orderIdCol: 6,
    trackingNumberCol: 5,
    carrierCol: null,
    fixedCarrierId: 'KDEXP',
    description: '고객사주문번호 6열, 운송장번호 5열, 택배사 경동택배 고정',
  },
  {
    id: 'daesin-invoice-registration',
    name: '대신택배 송장등록 양식',
    orderIdCol: 10,
    trackingNumberCol: 3,
    carrierCol: null,
    fixedCarrierId: 'DAESIN',
    description: '품명 10열, 운송장번호 3열, 택배사 대신택배 고정',
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
    reason?: string
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
  const [password, setPassword] = useState('1')
  const [result, setResult] = useState<ParsedResult | null>(null)
  const [detailView, setDetailView] = useState<'unmatched' | 'invalid' | null>(null)
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
    setDetailView(null)
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
      if (password.trim()) formData.append('password', password.trim())

      const res = await fetch('/api/shipping/import', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const raw = await res.text().catch(() => '')
        let message = raw.trim()
        try {
          const data = raw ? JSON.parse(raw) as { error?: string } : {}
          message = data.error ?? message
        } catch {
          // Non-JSON framework errors still carry useful text in the body.
        }
        toast.error(message || `엑셀 파일 처리에 실패했습니다. (HTTP ${res.status})`)
        return
      }

      const data = await res.json() as ParsedResult
      setResult(data)
      setDetailView(null)

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
        carrierId: m.carrierId ?? selectedTemplate.fixedCarrierId ?? 'CJGLS',
      }))

      const uploadResult = await bulkUploadInvoiceAction(orders)

      if (uploadResult.errors.length === 0) {
        toast.success(`${uploadResult.queued}건 송장등록 완료`)
        onOpenChange(false)
        setFile(null)
        setResult(null)
        setDetailView(null)
        setOrderIdCol(null)
        setTrackingCol(null)
        setCarrierCol(null)
      } else {
        toast.warning(
          `${uploadResult.queued}건 성공, ${uploadResult.errors.length}건 실패`,
        )
        for (const failure of uploadResult.errors.slice(0, 5)) {
          toast.error(failure.error, { duration: 7000 })
        }
      }
    })
  }

  const handleClose = () => {
    onOpenChange(false)
    setFile(null)
    setResult(null)
    setDetailView(null)
    setTemplateId(INVOICE_IMPORT_TEMPLATES[0].id)
    setOrderIdCol(null)
    setTrackingCol(null)
    setCarrierCol(null)
    setPassword('1')
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
                setResult(null)
                setDetailView(null)
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
                    {CARRIER_LABELS[selectedTemplate.fixedCarrierId ?? ''] ?? selectedTemplate.fixedCarrierId} 고정
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

          <div>
            <label htmlFor="excel-password" className="mb-1 block text-sm font-medium">
              엑셀 비밀번호
            </label>
            <input
              id="excel-password"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="구형/암호화 엑셀 비밀번호"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              CJ 구형 엑셀처럼 암호화된 파일은 기본값 1로 자동 해제합니다.
            </p>
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
          <p className="text-xs text-muted-foreground">
            파일 분석은 엑셀의 주문번호와 송장번호를 먼저 읽어 매칭 여부를 확인하는 단계입니다. 매칭된 건이 있으면 아래 송장등록 버튼이 표시됩니다.
          </p>

          {/* Results */}
          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-md bg-green-50 p-2 text-center text-green-700">
                  매칭: {result.matched.length}건
                </div>
                <button
                  type="button"
                  onClick={() => setDetailView((current) => current === 'unmatched' ? null : 'unmatched')}
                  disabled={result.unmatched.length === 0}
                  className="rounded-md bg-yellow-50 p-2 text-center text-yellow-700 hover:bg-yellow-100 disabled:cursor-default disabled:opacity-70"
                >
                  미매칭: {result.unmatched.length}건
                  {result.unmatched.length > 0 && <span className="ml-1 text-xs underline">확인</span>}
                </button>
                <button
                  type="button"
                  onClick={() => setDetailView((current) => current === 'invalid' ? null : 'invalid')}
                  disabled={result.invalid.length === 0}
                  className="rounded-md bg-red-50 p-2 text-center text-red-700 hover:bg-red-100 disabled:cursor-default disabled:opacity-70"
                >
                  오류: {result.invalid.length}건
                  {result.invalid.length > 0 && <span className="ml-1 text-xs underline">확인</span>}
                </button>
              </div>

              {detailView === 'unmatched' && (
                <div className="max-h-48 overflow-auto rounded-md border border-yellow-200">
                  <table className="w-full text-sm">
                    <thead className="bg-yellow-50">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">내부/주문번호</th>
                        <th className="px-3 py-1.5 text-left font-medium">송장번호</th>
                        <th className="px-3 py-1.5 text-left font-medium">택배사</th>
                        <th className="px-3 py-1.5 text-left font-medium">사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.unmatched.map((row, index) => (
                        <tr key={`${row.orderIdentifier}-${row.trackingNumber}-${index}`} className="border-t">
                          <td className="px-3 py-1.5 font-mono">{row.orderIdentifier || '-'}</td>
                          <td className="px-3 py-1.5">{row.trackingNumber || '-'}</td>
                          <td className="px-3 py-1.5">{row.carrierId ?? '-'}</td>
                          <td className="px-3 py-1.5">{row.reason ?? '주문 매칭 안됨'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {detailView === 'invalid' && (
                <div className="max-h-48 overflow-auto rounded-md border border-red-200">
                  <table className="w-full text-sm">
                    <thead className="bg-red-50">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">행</th>
                        <th className="px-3 py-1.5 text-left font-medium">오류 내용</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.invalid.map((row) => (
                        <tr key={row.row} className="border-t">
                          <td className="px-3 py-1.5 font-mono">{row.row}</td>
                          <td className="px-3 py-1.5">{row.errors.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

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
                {isApplying ? '등록중...' : `${result.matched.length}건 송장등록`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
