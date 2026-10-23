'use client'

import { type ChangeEvent, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Check, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'

type PreviewStatus = 'new' | 'changed' | 'unchanged' | 'invalid'

type ImportPreviewRow = {
  row: number | null
  status: PreviewStatus
  warehouseCode: string
  sku: string
  productName: string
  optionName: string
  beforeQuantity: number | null
  afterQuantity: number | null
  message: string
}

type ImportPreview = {
  rows: ImportPreviewRow[]
  counts: Record<PreviewStatus, number>
  errors: ImportPreviewError[]
}

type ImportPreviewError = {
  row: number | null
  message: string
}

const templateUrl = '/api/purchasing/saas-china-inventory/excel-template'
const exportUrl = '/api/purchasing/saas-china-inventory/excel-export'
const previewUrl = '/api/purchasing/saas-china-inventory/excel-import/preview'
const applyUrl = '/api/purchasing/saas-china-inventory/excel-import/apply'

export function SaasChinaInventoryExcelDialog() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  const hasErrors = Boolean(preview && (preview.errors.length > 0 || preview.counts.invalid > 0))

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
        toast.error(readError(record) ?? (mode === 'preview' ? '엑셀을 검토하지 못했습니다.' : '엑셀 재고 변경을 반영하지 못했습니다.'))
        return
      }

      if (mode === 'preview') {
        if (nextPreview && (nextPreview.errors.length > 0 || nextPreview.counts.invalid > 0)) {
          toast.error('엑셀에서 확인할 항목을 찾았습니다.')
        } else {
          toast.success('엑셀 검토가 끝났습니다. 변경 내용을 반영할 수 있습니다.')
        }
        return
      }

      const changedCount = nextPreview?.counts.new ?? 0
      const updateCount = nextPreview?.counts.changed ?? 0
      const appliedCount = changedCount + updateCount
      toast.success(appliedCount > 0 ? `${appliedCount.toLocaleString('ko-KR')}개 재고 항목을 엑셀로 반영했습니다.` : '엑셀 재고 변경을 반영했습니다.')
      setOpen(false)
      resetSelection()
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
        엑셀로 재고 변경
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeDialog()
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="saas-inventory-excel-title"
            aria-describedby="saas-inventory-excel-description"
            className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-lg bg-background p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="saas-inventory-excel-title" className="text-lg font-semibold">SaaS 중국재고 엑셀 변경</h3>
                <p id="saas-inventory-excel-description" className="mt-1 text-sm text-muted-foreground">현재고를 입력한 수량으로 변경합니다. 업로드에 없는 기존 재고는 삭제하지 않으며, 기존 행의 빈 셀은 현재 값을 유지합니다.</p>
              </div>
              <button type="button" onClick={closeDialog} disabled={isWorking} aria-label="엑셀 재고 변경 닫기" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <a href={templateUrl} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
                <Download className="size-4" />
                양식 다운로드
              </a>
              <a href={exportUrl} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
                <Download className="size-4" />
                현재 목록 다운로드
              </a>
            </div>

            <div className="mt-4 rounded-lg border bg-muted/20 p-4">
              <p className="text-sm font-medium">엑셀 파일 선택</p>
              <p className="mt-1 text-xs text-muted-foreground">현재 목록에서는 상품명과 현재고를 수정하세요. 메모는 현재고 변경 또는 신규 등록 사유로 기록됩니다. 중국창고·품목코드·옵션명은 변경할 수 없습니다.</p>
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
                {preview.rows.length > 0 ? <PreviewTable rows={preview.rows} /> : null}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="text-xs text-muted-foreground">검토 후에도 예약 수량이나 발주 연동 수량보다 적게 변경할 수는 없습니다.</p>
                  <button type="button" onClick={() => void upload('apply')} disabled={isWorking || hasErrors} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    {isWorking ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    검토 결과 반영
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

function PreviewSummary({ preview }: { preview: ImportPreview }) {
  const hasErrors = preview.errors.length > 0 || preview.counts.invalid > 0
  return (
    <section className={`rounded-lg border p-4 ${hasErrors ? 'border-red-200 bg-red-50/70' : 'border-emerald-200 bg-emerald-50/70'}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>신규 <strong>{preview.counts.new.toLocaleString('ko-KR')}개</strong></span>
        <span>변경 <strong>{preview.counts.changed.toLocaleString('ko-KR')}개</strong></span>
        <span>변경 없음 <strong>{preview.counts.unchanged.toLocaleString('ko-KR')}개</strong></span>
        {preview.counts.invalid > 0 ? <span className="font-medium text-red-800">확인 필요 {preview.counts.invalid.toLocaleString('ko-KR')}개</span> : null}
      </div>
      {hasErrors ? (
        <div className="mt-3 flex gap-2 text-sm text-red-900">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">오류가 있는 행은 반영할 수 없습니다.</p>
            {preview.errors.length > 0 ? (
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                {preview.errors.slice(0, 10).map((error, index) => (
                  <li key={`${error.row ?? 'general'}:${error.message}:${index}`}>
                    {error.row !== null ? <><span>{error.row}</span><span>행: </span></> : null}
                    <span>{error.message}</span>
                  </li>
                ))}
                {preview.errors.length > 10 ? <li>{`외 ${preview.errors.length - 10}건`}</li> : null}
              </ul>
            ) : null}
          </div>
        </div>
      ) : <p className="mt-2 text-xs text-emerald-900">검토가 완료되었습니다. 아래 내용을 확인한 뒤 반영할 수 있습니다.</p>}
    </section>
  )
}

function PreviewTable({ rows }: { rows: ImportPreviewRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">행</th>
              <th className="px-3 py-2 font-medium">검토 결과</th>
              <th className="px-3 py-2 font-medium">창고</th>
              <th className="px-3 py-2 font-medium">품목</th>
              <th className="px-3 py-2 text-right font-medium">기존 현재고</th>
              <th className="px-3 py-2 text-right font-medium">변경 현재고</th>
              <th className="px-3 py-2 font-medium">안내</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.row ?? 'row'}:${index}`} className={`border-t ${row.status === 'invalid' ? 'bg-red-50/60' : ''}`}>
                <td className="px-3 py-2 text-xs text-muted-foreground">{row.row ?? '-'}</td>
                <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                <td data-no-translate className="px-3 py-2 text-xs">{row.warehouseCode || '-'}</td>
                <td className="px-3 py-2">
                  <p data-no-translate className="font-medium">{row.productName || '-'}</p>
                  <p data-no-translate className="mt-0.5 text-xs text-muted-foreground">{[row.sku, row.optionName].filter(Boolean).join(' · ') || '-'}</p>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(row.beforeQuantity)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{formatQuantity(row.afterQuantity)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{row.message || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: PreviewStatus }) {
  const label: Record<PreviewStatus, string> = {
    new: '신규 추가',
    changed: '변경',
    unchanged: '변경 없음',
    invalid: '확인 필요',
  }
  const className: Record<PreviewStatus, string> = {
    new: 'bg-sky-100 text-sky-800',
    changed: 'bg-amber-100 text-amber-800',
    unchanged: 'bg-muted text-muted-foreground',
    invalid: 'bg-red-100 text-red-800',
  }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className[status]}`}>{label[status]}</span>
}

function normalizePreview(value: unknown): ImportPreview | null {
  const record = asRecord(value)
  if (!record) return null
  const rows = Array.isArray(record.rows) ? record.rows.map(normalizeRow).filter((row): row is ImportPreviewRow => row !== null) : []
  const errors = Array.isArray(record.errors) ? record.errors.map(normalizeError).filter((error): error is ImportPreviewError => error !== null) : []
  const summary = asRecord(record.summary)
  const counts: Record<PreviewStatus, number> = {
    new: countValue(summary, ['newCount', 'createdCount', 'newRows'], rows, 'new'),
    changed: countValue(summary, ['changedCount', 'updatedCount', 'changeCount'], rows, 'changed'),
    unchanged: countValue(summary, ['unchangedCount', 'sameCount', 'skippedCount'], rows, 'unchanged'),
    invalid: countValue(summary, ['invalidCount', 'errorCount'], rows, 'invalid'),
  }
  counts.invalid = Math.max(counts.invalid, errors.length)
  return { rows, counts, errors }
}

function normalizeRow(value: unknown): ImportPreviewRow | null {
  const record = asRecord(value)
  if (!record) return null
  const nested = asRecord(record.input) ?? asRecord(record.item) ?? {}
  const error = readString(record.error)
  const message = readString(record.message) || error || readString(record.reason)
  return {
    row: readNumber(record.row) ?? readNumber(record.rowNumber),
    status: readStatus(record.status ?? record.action ?? record.type, error),
    warehouseCode: readString(record.warehouseCode) || readString(nested.warehouseCode) || readString(record.warehouse),
    sku: readString(record.sku) || readString(nested.sku) || readString(record.productCode),
    productName: readString(record.productName) || readString(nested.productName) || readString(record.name),
    optionName: readString(record.optionName) || readString(nested.optionName) || readString(record.option),
    beforeQuantity: readNumber(record.beforeQuantity) ?? readNumber(record.currentQuantity) ?? readNumber(record.existingQuantity),
    afterQuantity: readNumber(record.afterQuantity) ?? readNumber(record.targetQuantity) ?? readNumber(record.quantity),
    message,
  }
}

function countValue(summary: Record<string, unknown> | null, keys: string[], rows: ImportPreviewRow[], status: PreviewStatus) {
  for (const key of keys) {
    const value = readNumber(summary?.[key])
    if (value !== null) return value
  }
  return rows.filter((row) => row.status === status).length
}

function readStatus(value: unknown, message: string): PreviewStatus {
  const normalized = readString(value).toLowerCase()
  if (['new', 'create', 'created', 'add', 'added'].includes(normalized)) return 'new'
  if (['changed', 'change', 'update', 'updated', 'modify', 'modified'].includes(normalized)) return 'changed'
  if (['unchanged', 'same', 'skip', 'skipped', 'no_change'].includes(normalized)) return 'unchanged'
  if (['invalid', 'error', 'blocked', 'failed'].includes(normalized) || message) return 'invalid'
  return 'unchanged'
}

function normalizeError(value: unknown): ImportPreviewError | null {
  if (typeof value === 'string') {
    const match = /^(\d+)행:\s*(.+)$/.exec(value)
    return match
      ? { row: Number(match[1]), message: match[2]!.trim() }
      : value.trim() ? { row: null, message: value.trim() } : null
  }
  const record = asRecord(value)
  if (!record) return null
  const row = readNumber(record.row) ?? readNumber(record.rowNumber)
  const message = readString(record.message) || readString(record.error)
  return message ? { row, message } : null
}

function readError(record: Record<string, unknown> | null) {
  if (!record) return null
  return readString(record.error) || readString(record.message)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function formatQuantity(value: number | null) {
  return value === null ? '-' : value.toLocaleString('ko-KR')
}
