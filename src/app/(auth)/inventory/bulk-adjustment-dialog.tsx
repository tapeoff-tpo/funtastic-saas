'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type AdjustmentReason = 'incoming' | 'order_ship' | 'physical_count' | 'defective' | 'other'

interface AdjustmentRow {
  rowNum: number
  sku: string
  productName: string
  optionName: string | null
  warehouseZone: string | null
  sectorCode: string | null
  delta: number
  reason: AdjustmentReason
  note: string
  inventoryExists: boolean
  currentStock: number
  error?: string
}

interface ConfirmResult {
  total: number
  success: number
  failed: number
  errors: Array<{ rowNum?: number; sku: string; error: string }>
}

type Step = 'upload' | 'preview' | 'done'

interface BulkAdjustmentDialogProps {
  onClose: () => void
  warehouseZones: string[]
}

const REASON_LABELS: Record<AdjustmentReason, string> = {
  incoming: '입고',
  order_ship: '출고',
  physical_count: '실사조정',
  defective: '불용/불량',
  other: '기타',
}

export function BulkAdjustmentDialog({ onClose, warehouseZones }: BulkAdjustmentDialogProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [warehouseZone, setWarehouseZone] = useState(warehouseZones[0] ?? '')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [rows, setRows] = useState<AdjustmentRow[]>([])
  const [sheetName, setSheetName] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<ConfirmResult | null>(null)

  const handleParse = async () => {
    if (!file) return
    if (!warehouseZone) {
      setParseError('창고를 선택해주세요.')
      return
    }
    setParsing(true)
    setParseError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('warehouseZone', warehouseZone)
      const res = await fetch('/api/inventory/adjustments/parse', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) {
        setParseError(data.error ?? `HTTP ${res.status}`)
        return
      }
      setRows(data.rows ?? [])
      setSheetName(data.sheetName ?? '')
      setStep('preview')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '파일 인식 중 오류가 발생했습니다.')
    } finally {
      setParsing(false)
    }
  }

  const updateRow = (idx: number, patch: Partial<AdjustmentRow>) => {
    setRows((prev) => prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)))
  }

  const handleConfirm = async () => {
    const validRows = rows.filter((row) => row.inventoryExists && !row.error && row.delta !== 0)
    if (validRows.length === 0) return
    setConfirming(true)
    try {
      const res = await fetch('/api/inventory/adjustments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: validRows.map((row) => ({
            rowNum: row.rowNum,
            sku: row.sku,
            warehouseZone: row.warehouseZone,
            sectorCode: row.sectorCode,
            delta: row.delta,
            reason: row.reason,
            note: row.note || undefined,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult({
          total: 0,
          success: 0,
          failed: 1,
          errors: [{ sku: '-', error: data.error ?? `HTTP ${res.status}` }],
        })
      } else {
        setResult(data)
      }
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

  const validRows = rows.filter((row) => row.inventoryExists && !row.error && row.delta !== 0)
  const invalidCount = rows.length - validRows.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`flex w-full flex-col rounded-lg bg-white shadow-xl ${step === 'preview' ? 'max-h-[90vh] max-w-6xl' : 'max-w-md'}`}>
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-base font-semibold">대량 재고조정</h3>
            {step === 'preview' && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                창고: {warehouseZone} · 시트: {sheetName} · {rows.length}건 인식 · 수량/사유 수정 후 확정하세요
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-lg leading-none text-muted-foreground hover:text-foreground">
            x
          </button>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {step === 'upload' && (
            <div className="space-y-4 p-6">
              <p className="text-sm text-muted-foreground">
                창고를 선택한 뒤 상품코드, 사유, 입고증가/차감 수량이 있는 엑셀을 업로드하세요.
              </p>
              <p className="text-xs text-muted-foreground">
                수량은 양수면 입고/증가, 음수면 차감입니다. 선택한 창고의 재고만 조정됩니다.
              </p>
              <label className="block space-y-1">
                <span className="text-sm font-medium">창고선택</span>
                <select
                  value={warehouseZone}
                  onChange={(e) => { setWarehouseZone(e.target.value); setParseError(null) }}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                >
                  {warehouseZones.length === 0 && <option value="">등록된 창고 없음</option>}
                  {warehouseZones.map((zone) => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </select>
              </label>
              <a
                href="/api/inventory/adjustments/template"
                className="inline-flex rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                엑셀양식 다운로드
              </a>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setParseError(null) }}
                className="w-full rounded-md border px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm"
              />
              {parseError && <p className="text-sm text-red-600">{parseError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm hover:bg-muted">
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!file || !warehouseZone || parsing}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {parsing ? '인식 중...' : '파일 인식'}
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <>
              {invalidCount > 0 && (
                <div className="mx-6 mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {invalidCount}건은 미등록/오류/변동수량 0으로 제외됩니다.
                </div>
              )}
              <div className="mx-6 mb-3 mt-3 flex-1 overflow-auto rounded-md border">
                <table className="w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-muted/80">
                    <tr>
                      <th className="w-10 border-b px-2 py-1.5 text-left font-medium">행</th>
                      <th className="border-b px-2 py-1.5 text-left font-medium">상품코드</th>
                      <th className="border-b px-2 py-1.5 text-left font-medium">상품명</th>
                      <th className="border-b px-2 py-1.5 text-left font-medium">창고</th>
                      <th className="border-b px-2 py-1.5 text-left font-medium">로케이션</th>
                      <th className="w-20 border-b px-2 py-1.5 text-right font-medium">현재고</th>
                      <th className="w-24 border-b px-2 py-1.5 text-center font-medium">변동수량</th>
                      <th className="w-28 border-b px-2 py-1.5 text-left font-medium">사유</th>
                      <th className="border-b px-2 py-1.5 text-left font-medium">메모</th>
                      <th className="border-b px-2 py-1.5 text-left font-medium">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={`${row.rowNum}-${idx}`} className={`border-b last:border-b-0 ${row.error || !row.inventoryExists ? 'bg-amber-50/50' : idx % 2 ? 'bg-muted/20' : ''}`}>
                        <td className="px-2 py-1 text-muted-foreground">{row.rowNum}</td>
                        <td className="whitespace-nowrap px-2 py-1 font-mono">{row.sku}</td>
                        <td className="max-w-[180px] truncate px-2 py-1" title={row.productName}>{row.productName}</td>
                        <td className="px-2 py-1">{row.warehouseZone ?? '-'}</td>
                        <td className="px-2 py-1 font-mono">{row.sectorCode ?? '-'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{row.currentStock.toLocaleString('ko-KR')}</td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={row.delta}
                            onChange={(e) => updateRow(idx, { delta: Number(e.target.value) || 0 })}
                            className="w-full rounded border px-1.5 py-0.5 text-center text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={row.reason}
                            onChange={(e) => updateRow(idx, { reason: e.target.value as AdjustmentReason })}
                            className="w-full rounded border px-1.5 py-0.5 text-xs"
                          >
                            {Object.entries(REASON_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.note}
                            onChange={(e) => updateRow(idx, { note: e.target.value })}
                            className="w-full rounded border px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>
                        <td className="px-2 py-1 text-xs">
                          {row.error
                            ? <span className="text-red-600">{row.error}</span>
                            : row.inventoryExists
                              ? <span className="text-green-700">가능</span>
                              : <span className="text-amber-600">미등록</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t px-6 py-3">
                <p className="text-xs text-muted-foreground">
                  적용 {validRows.length}건 · 변동 합계 {validRows.reduce((sum, row) => sum + row.delta, 0).toLocaleString('ko-KR')}개
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep('upload')} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                    뒤로
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={confirming || validRows.length === 0}
                    className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {confirming ? '처리 중...' : `대량등록 (${validRows.length}건)`}
                  </button>
                </div>
              </div>
            </>
          )}

          {step === 'done' && result && (
            <div className="space-y-4 p-6">
              <div className="rounded-md border p-4">
                <p className="text-sm font-medium">
                  총 {result.total}건 중 <span className="text-green-600">{result.success}건 완료</span>
                  {result.failed > 0 && (
                    <>
                      , <span className="text-red-600">{result.failed}건 실패</span>
                    </>
                  )}
                </p>
                {result.errors.length > 0 && (
                  <div className="mt-3 max-h-40 space-y-1 overflow-y-auto">
                    {result.errors.map((err, idx) => (
                      <p key={idx} className="text-xs text-red-600">
                        {err.rowNum ? `${err.rowNum}행 ` : ''}{err.sku}: {err.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={handleDone} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
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
