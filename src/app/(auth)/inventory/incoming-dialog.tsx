'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface IncomingRow {
  rowNum: number
  sku: string
  productName: string
  optionName: string | null
  quantity: number
  sectorCode: string | null
  note: string
  inventoryExists: boolean
  currentStock: number
}

interface ConfirmResult {
  total: number
  success: number
  failed: number
  errors: Array<{ sku: string; error: string }>
}

type Step = 'upload' | 'preview' | 'done'

interface IncomingDialogProps {
  onClose: () => void
}

export function IncomingDialog({ onClose }: IncomingDialogProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [sheetName, setSheetName] = useState<string>('')
  const [rows, setRows] = useState<IncomingRow[]>([])
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<ConfirmResult | null>(null)

  const handleParse = async () => {
    if (!file) return
    setParsing(true)
    setParseError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/inventory/incoming/parse', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        setParseError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setRows(data.rows)
      setSheetName(data.sheetName ?? '')
      setStep('preview')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '파싱 중 오류가 발생했습니다.')
    } finally {
      setParsing(false)
    }
  }

  const handleQuantityChange = (idx: number, value: string) => {
    const qty = parseInt(value, 10)
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, quantity: Number.isNaN(qty) ? 0 : qty } : r)),
    )
  }

  const handleNoteChange = (idx: number, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, note: value } : r)))
  }

  const handleRemoveRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleConfirm = async () => {
    const validRows = rows.filter((r) => r.quantity > 0)
    if (validRows.length === 0) return
    setConfirming(true)
    try {
      const res = await fetch('/api/inventory/incoming/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: validRows.map((r) => ({ sku: r.sku, quantity: r.quantity, note: r.note || undefined })),
        }),
      })
      const data = await res.json()
      setResult(data)
      setStep('done')
    } catch (err) {
      setResult({
        total: 0,
        success: 0,
        failed: 1,
        errors: [{ sku: '-', error: err instanceof Error ? err.message : '오류가 발생했습니다.' }],
      })
      setStep('done')
    } finally {
      setConfirming(false)
    }
  }

  const handleDone = () => {
    router.refresh()
    onClose()
  }

  const unknownCount = rows.filter((r) => !r.inventoryExists).length
  const validRows = rows.filter((r) => r.quantity > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={`w-full rounded-lg bg-white shadow-xl flex flex-col ${step === 'preview' ? 'max-w-4xl max-h-[90vh]' : 'max-w-md'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-base font-semibold">입고 처리</h3>
            {step === 'preview' && (
              <p className="text-xs text-muted-foreground mt-0.5">
                시트: {sheetName} · {rows.length}건 인식 · 수량/비고 수정 후 확정하세요
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                입고 Excel 파일을 업로드하세요. <strong>제품단위</strong> 시트를 자동으로 인식합니다.
              </p>
              <p className="text-xs text-muted-foreground">
                필수 컬럼: 품목코드, 실제 출고 수량 · 인식 후 수량 수정 가능
              </p>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setParseError(null) }}
                className="w-full rounded-md border px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm"
              />
              {parseError && (
                <p className="text-sm text-red-600">{parseError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!file || parsing}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {parsing ? '파싱 중...' : '파일 인식'}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Preview / Edit */}
          {step === 'preview' && (
            <>
              {unknownCount > 0 && (
                <div className="mx-6 mt-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                  ⚠ {unknownCount}건은 재고 데이터가 없습니다. 입고 처리 시 재고가 없는 SKU는 실패합니다.
                </div>
              )}

              {/* Editable table */}
              <div className="flex-1 overflow-auto mx-6 mt-3 mb-3 border rounded-md">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-muted/80">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium border-b w-6">#</th>
                      <th className="px-2 py-1.5 text-left font-medium border-b">SKU</th>
                      <th className="px-2 py-1.5 text-left font-medium border-b">상품명</th>
                      <th className="px-2 py-1.5 text-left font-medium border-b">옵션명</th>
                      <th className="px-2 py-1.5 text-right font-medium border-b w-16">현재고</th>
                      <th className="px-2 py-1.5 text-center font-medium border-b w-20">입고수량</th>
                      <th className="px-2 py-1.5 text-left font-medium border-b">비고</th>
                      <th className="px-2 py-1.5 border-b w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`border-b last:border-b-0 ${!row.inventoryExists ? 'bg-amber-50/50' : idx % 2 === 1 ? 'bg-muted/20' : ''}`}
                      >
                        <td className="px-2 py-1 text-muted-foreground">{idx + 1}</td>
                        <td className="px-2 py-1 font-mono whitespace-nowrap">
                          {row.sku}
                          {!row.inventoryExists && (
                            <span className="ml-1 text-amber-500 text-[10px]">미등록</span>
                          )}
                        </td>
                        <td className="px-2 py-1 max-w-[160px] truncate" title={row.productName}>
                          {row.productName}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {row.optionName ?? '-'}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{row.currentStock}</td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={0}
                            value={row.quantity}
                            onChange={(e) => handleQuantityChange(idx, e.target.value)}
                            className="w-full rounded border px-1.5 py-0.5 text-center tabular-nums text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.note}
                            placeholder="메모"
                            onChange={(e) => handleNoteChange(idx, e.target.value)}
                            className="w-full rounded border px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(idx)}
                            className="text-muted-foreground hover:text-red-500"
                            title="제외"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t px-6 py-3">
                <p className="text-xs text-muted-foreground">
                  {validRows.length}건 · 총 입고수량 {validRows.reduce((s, r) => s + r.quantity, 0).toLocaleString()}개
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep('upload')}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    뒤로
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={confirming || validRows.length === 0}
                    className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {confirming ? '처리 중...' : `입고 확정 (${validRows.length}건)`}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Step 3: Done */}
          {step === 'done' && result && (
            <div className="p-6 space-y-4">
              <div className="rounded-md border p-4">
                <p className="font-medium text-sm">
                  총 {result.total}건 중{' '}
                  <span className="text-green-600">{result.success}건 입고 완료</span>
                  {result.failed > 0 && (
                    <>, <span className="text-red-600">{result.failed}건 실패</span></>
                  )}
                </p>
                {result.errors.length > 0 && (
                  <div className="mt-3 max-h-40 space-y-1 overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-xs text-red-600">
                        {err.sku}: {err.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleDone}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  완료
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
