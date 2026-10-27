'use client'

import { type ChangeEvent, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Check, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

type ShipmentExcelPreviewError = {
  sheet: string
  row: number | null
  message: string
}

type ShipmentExcelPreview = {
  summary: {
    itemCount: number
    boxCount: number
    palletCount: number
    totalQuantity: number
    invalidCount: number
  }
  errors: ShipmentExcelPreviewError[]
  existingShipmentId: string | null
  existingShipmentNo: string | null
  alreadyRegistered: boolean
}

const templateUrl = '/api/purchasing/china-shipments/excel-template'
const previewUrl = '/api/purchasing/china-shipments/excel-import/preview'
const applyUrl = '/api/purchasing/china-shipments/excel-import/apply'

/**
 * Register a new SaaS China outbound shipment from a reviewed workbook.
 * The server is responsible for resolving current inventory and applying the
 * reservation, boxes, and pallets in one transaction.
 */
export function ChinaShipmentExcelDialog({
  onApplied,
}: {
  onApplied?: (shipmentId: string | null) => void
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ShipmentExcelPreview | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  const hasErrors = Boolean(preview && (preview.summary.invalidCount > 0 || preview.errors.length > 0))

  function resetSelection() {
    setFile(null)
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function closeDialog() {
    if (isWorking) return
    setOpen(false)
    resetSelection()
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null)
    setPreview(null)
  }

  async function upload(mode: 'preview' | 'apply') {
    if (!file) {
      toast.error('업로드할 엑셀 파일을 선택해주세요.')
      return
    }
    if (mode === 'apply' && (!preview || hasErrors)) {
      toast.error('엑셀을 먼저 검토하고 오류를 해결한 뒤 반영해주세요.')
      return
    }

    setIsWorking(true)
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch(mode === 'preview' ? previewUrl : applyUrl, {
        method: 'POST',
        body: form,
      })
      const body: unknown = await response.json().catch(() => ({}))
      const record = asRecord(body)
      const nextPreview = normalizePreview(record?.preview ?? body)
      if (nextPreview) setPreview(nextPreview)

      if (!response.ok) {
        toast.error(readError(record) ?? (mode === 'preview' ? '중국출고 엑셀을 검토하지 못했습니다.' : '중국출고 엑셀을 반영하지 못했습니다.'))
        return
      }

      if (mode === 'preview') {
        if (nextPreview && (nextPreview.summary.invalidCount > 0 || nextPreview.errors.length > 0)) {
          toast.error('엑셀에서 확인할 항목을 찾았습니다.')
        } else if (nextPreview?.alreadyRegistered) {
          toast.success('이 엑셀은 이미 등록되었습니다. 기존 중국출고 작업을 열 수 있습니다.')
        } else {
          toast.success('엑셀 검토가 끝났습니다. 출고 등록 내용을 반영할 수 있습니다.')
        }
        return
      }

      const result = asRecord(record?.result)
      const shipmentId = readString(result?.shipmentId) || readString(record?.shipmentId) || null
      const shipmentNo = readString(result?.shipmentNo) || readString(record?.shipmentNo)
      const created = readBoolean(result?.created)
      toast.success(created === false
        ? (shipmentNo ? `${shipmentNo}은 이미 등록된 중국출고입니다.` : '이 엑셀은 이미 등록된 중국출고입니다.')
        : (shipmentNo ? `${shipmentNo} 중국출고를 엑셀로 등록했습니다.` : '중국출고를 엑셀로 등록했습니다.'))
      setOpen(false)
      resetSelection()
      onApplied?.(shipmentId)
      router.refresh()
    } catch {
      toast.error('엑셀 업로드 중 연결 오류가 발생했습니다.')
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
      >
        <FileSpreadsheet className="size-4" />
        엑셀로 출고 등록
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeDialog()
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="china-shipment-excel-title"
            aria-describedby="china-shipment-excel-description"
            className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-lg bg-background p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="china-shipment-excel-title" className="text-lg font-semibold">중국출고 엑셀 등록</h3>
                <p id="china-shipment-excel-description" className="mt-1 text-sm text-muted-foreground">출고상품과 박스 쉽먼트 내용을 한 파일에서 검토한 뒤 새 중국출고 작업으로 등록합니다.</p>
                <p className="mt-1 text-xs text-muted-foreground">엑셀 검토만으로는 재고가 예약되지 않습니다. 검토 결과 반영을 눌러야 출고 재고 예약·박스·파렛트가 함께 등록됩니다.</p>
              </div>
              <button type="button" onClick={closeDialog} disabled={isWorking} aria-label="중국출고 엑셀 등록 닫기" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <a href={templateUrl} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
                <Download className="size-4" />
                양식 다운로드
              </a>
            </div>

            <div className="mt-4 rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">엑셀 파일 선택</p>
              <p className="mt-1 text-xs text-muted-foreground">출고정보의 출고창고를 한 번만 확인하면 출고상품·박스 쉽먼트의 빈 출고창고 칸에 자동 적용됩니다. 여러 창고 출고일 때만 해당 행의 창고를 직접 입력하세요.</p>
              <p className="mt-1 text-xs text-muted-foreground">출고정보와 출고상품은 필수입니다. 박스 쉽먼트와 파렛트 번호는 필요한 경우 함께 입력하세요.</p>
              <p className="mt-1 text-xs text-muted-foreground">출고창고·품목코드·옵션명은 현재 SaaS 중국재고와 대조하며, 수량이 작업 가능 재고를 넘으면 반영할 수 없습니다.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="inline-flex h-9 max-w-full cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted">
                  <Upload className="size-4 shrink-0" />
                  <span className="max-w-64 truncate">{file ? file.name : '엑셀 파일 선택'}</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                    onChange={chooseFile}
                    disabled={isWorking}
                    className="sr-only"
                  />
                </label>
                {file ? <button type="button" onClick={resetSelection} disabled={isWorking} className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">선택 취소</button> : null}
                <button type="button" onClick={() => void upload('preview')} disabled={!file || isWorking} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">
                  {isWorking ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
                  엑셀 검토
                </button>
              </div>
            </div>

            {preview ? (
              <div className="mt-4 space-y-4">
                <PreviewSummary preview={preview} />
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="text-xs text-muted-foreground">오류가 하나라도 있으면 출고 재고 예약과 박스 쉽먼트를 전혀 등록하지 않습니다.</p>
                  <button type="button" onClick={() => void upload('apply')} disabled={isWorking || hasErrors} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {isWorking ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    {preview.alreadyRegistered ? '기존 출고 열기' : '검토 결과 반영'}
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  )
}

function PreviewSummary({ preview }: { preview: ShipmentExcelPreview }) {
  const hasErrors = preview.summary.invalidCount > 0 || preview.errors.length > 0
  return (
    <section className={`rounded-lg border p-4 ${hasErrors ? 'border-red-200 bg-red-50/70' : 'border-emerald-200 bg-emerald-50/70'}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>출고상품 <strong>{preview.summary.itemCount.toLocaleString('ko-KR')}개</strong></span>
        <span>출고수량 <strong>{preview.summary.totalQuantity.toLocaleString('ko-KR')}개</strong></span>
        <span>박스 쉽먼트 <strong>{preview.summary.boxCount.toLocaleString('ko-KR')}개</strong></span>
        <span>파렛트 <strong>{preview.summary.palletCount.toLocaleString('ko-KR')}개</strong></span>
        {preview.summary.invalidCount > 0 ? <span className="font-medium text-red-800">확인 필요 {preview.summary.invalidCount.toLocaleString('ko-KR')}개</span> : null}
      </div>
      {hasErrors ? (
        <div className="mt-3 flex gap-2 text-sm text-red-900">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">확인 필요 항목이 있어 출고를 등록할 수 없습니다.</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
              {preview.errors.slice(0, 10).map((error, index) => (
                <li key={`${error.sheet}:${error.row ?? 'general'}:${error.message}:${index}`}>
                  {error.sheet ? <span>{error.sheet}</span> : null}
                  {error.row !== null ? <span>{error.sheet ? ' ' : ''}{error.row}행</span> : null}
                  {error.sheet || error.row !== null ? <span>: </span> : null}
                  <span>{error.message}</span>
                </li>
              ))}
              {preview.errors.length > 10 ? <li>외 {preview.errors.length - 10}건</li> : null}
            </ul>
          </div>
        </div>
      ) : preview.alreadyRegistered ? <p className="mt-2 text-xs text-emerald-900">{preview.existingShipmentNo || '이 엑셀'}은 이미 등록되었습니다. 기존 중국출고 작업을 열 수 있습니다.</p> : <p className="mt-2 text-xs text-emerald-900">검토가 완료되었습니다. 출고 재고 예약과 박스 쉽먼트 등록을 함께 반영할 수 있습니다.</p>}
    </section>
  )
}

function normalizePreview(value: unknown): ShipmentExcelPreview | null {
  const record = asRecord(value)
  if (!record) return null
  const summary = asRecord(record.summary)
  const errors = Array.isArray(record.errors)
    ? record.errors.map(normalizeError).filter((error): error is ShipmentExcelPreviewError => error !== null)
    : []
  const invalidCount = readNumber(summary?.invalidCount) ?? readNumber(summary?.errorCount) ?? errors.length
  return {
    summary: {
      itemCount: readNumber(summary?.itemCount) ?? readNumber(summary?.shipmentItemCount) ?? 0,
      boxCount: readNumber(summary?.boxCount) ?? 0,
      palletCount: readNumber(summary?.palletCount) ?? 0,
      totalQuantity: readNumber(summary?.totalQuantity) ?? readNumber(summary?.reservedQuantity) ?? 0,
      invalidCount: Math.max(invalidCount, errors.length),
    },
    errors,
    existingShipmentId: readString(record.existingShipmentId) || null,
    existingShipmentNo: readString(record.existingShipmentNo) || null,
    alreadyRegistered: readBoolean(record.alreadyRegistered) === true,
  }
}

function normalizeError(value: unknown): ShipmentExcelPreviewError | null {
  if (typeof value === 'string') return value.trim() ? { sheet: '', row: null, message: value.trim() } : null
  const record = asRecord(value)
  if (!record) return null
  const message = readString(record.message) || readString(record.error)
  if (!message) return null
  return {
    sheet: readString(record.sheet),
    row: readNumber(record.row) ?? readNumber(record.rowNumber),
    message,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readError(record: Record<string, unknown> | null) {
  return readString(record?.error) || readString(record?.message) || null
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}
