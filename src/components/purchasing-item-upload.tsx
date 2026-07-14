'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type ImportMode = 'cost-url-and-new' | 'new-only' | 'selected'

type ImportPreview = {
  total: number
  parsed: number
  skipped: number
  newItems: number
  updateItems: number
  changedItems: number
  unchangedItems: number
  skippedExisting: number
  invalidNewItems: number
  imported?: number
  inserted?: number
  updated?: number
  fieldChanges: Record<string, number>
  sampleChanges: Array<{
    sku: string
    name: string | null
    type: 'new' | 'update' | 'invalid-new'
    changedHeaders: string[]
  }>
}

const SELECTABLE_HEADERS = [
  '품목명',
  '규격정보',
  '한국창고기준 위치',
  '영문명',
  '검역대상 여부',
  '100KG 인증여부',
  'HS CODE',
  '재질',
  '특가(元)',
  '신규원가(元)',
  '상품원가(元)',
  '배송비(元)',
  'works 기존 원가',
  'works 신규 원가',
  '품목구분',
  '매입부가세',
  '보통영수증 (%)',
  '증취세영수증  (%)',
  '구매 URL',
] as const

const DEFAULT_SELECTED_HEADERS = [
  '특가(元)',
  '신규원가(元)',
  '상품원가(元)',
  '배송비(元)',
  'works 기존 원가',
  'works 신규 원가',
  '구매 URL',
]

const DEFAULT_DOWNLOAD_HEADERS = [
  '품목코드',
  '품목명',
  '규격정보',
  ...DEFAULT_SELECTED_HEADERS,
]

const EXTRA_DOWNLOAD_HEADERS = ['당월 출고수량', '3개월 평균 출고수량', '최근 반영일'] as const

export function PurchasingItemUpload() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [mode, setMode] = useState<ImportMode>('cost-url-and-new')
  const [createMissing, setCreateMissing] = useState(false)
  const [selectedHeaders, setSelectedHeaders] = useState<string[]>(DEFAULT_SELECTED_HEADERS)
  const [downloadHeaders, setDownloadHeaders] = useState<string[]>(DEFAULT_DOWNLOAD_HEADERS)
  const [downloadExtraHeaders, setDownloadExtraHeaders] = useState<string[]>([...EXTRA_DOWNLOAD_HEADERS])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const canApply = useMemo(() => {
    if (!preview) return false
    return preview.newItems + preview.changedItems > 0
  }, [preview])

  function close() {
    if (isPending) return
    setUploadOpen(false)
    setFile(null)
    setPreview(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function buildForm(intent: 'preview' | 'apply') {
    if (!file) return null
    const form = new FormData()
    form.set('file', file)
    form.set('intent', intent)
    form.set('mode', mode)
    form.set('createMissing', String(mode === 'selected' ? createMissing : mode !== 'new-only'))
    form.set('selectedHeaders', JSON.stringify(mode === 'selected' ? selectedHeaders : []))
    return form
  }

  function requestPreview() {
    if (!file) {
      toast.error('엑셀 파일을 선택해주세요.')
      return
    }
    setPreview(null)
    startTransition(async () => {
      const form = buildForm('preview')
      if (!form) return
      const response = await fetch('/api/purchasing/items/import', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? '업로드 미리보기에 실패했습니다.')
        return
      }
      setPreview(body)
      toast.success('업로드 미리보기를 만들었습니다.')
    })
  }

  function applyImport() {
    if (!file || !preview) return
    startTransition(async () => {
      const form = buildForm('apply')
      if (!form) return
      const response = await fetch('/api/purchasing/items/import', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(body.error ?? '품목 업로드에 실패했습니다.')
        return
      }
      setPreview(body)
      toast.success(`${(body.imported ?? 0).toLocaleString('ko-KR')}개 품목을 반영했습니다.`)
      if (inputRef.current) inputRef.current.value = ''
      setFile(null)
      router.refresh()
    })
  }

  function toggleHeader(header: string) {
    setSelectedHeaders((current) => (
      current.includes(header)
        ? current.filter((value) => value !== header)
        : [...current, header]
    ))
    setPreview(null)
  }

  function toggleDownloadHeader(header: string) {
    setDownloadHeaders((current) => {
      if (header === '품목코드') return current
      return current.includes(header)
        ? current.filter((value) => value !== header)
        : [...current, header]
    })
  }

  function toggleDownloadExtraHeader(header: string) {
    setDownloadExtraHeaders((current) => (
      current.includes(header)
        ? current.filter((value) => value !== header)
        : [...current, header]
    ))
  }

  function downloadUrl(template = false) {
    const params = new URLSearchParams()
    params.set('headers', downloadHeaders.join(','))
    params.set('extraHeaders', downloadExtraHeaders.join(','))
    if (template) params.set('template', '1')
    return `/api/purchasing/items/export?${params.toString()}`
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => setDownloadOpen(true)}>
          <Download className="size-4" />
          엑셀 다운로드
        </Button>
        <Button type="button" onClick={() => setUploadOpen(true)}>
          <Upload className="size-4" />
          엑셀 업로드
        </Button>
      </div>

      {downloadOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-4 pt-16" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-md border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-base font-semibold">품목 엑셀 다운로드</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">필요한 컬럼만 골라서 내려받습니다.</p>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setDownloadOpen(false)} aria-label="닫기">
                <X />
              </Button>
            </div>

            <div className="space-y-4 p-4">
              <div className="rounded-md border p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">품목 컬럼</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => setDownloadHeaders(['품목코드', ...SELECTABLE_HEADERS])}
                    >
                      전체 선택
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => setDownloadHeaders(DEFAULT_DOWNLOAD_HEADERS)}
                    >
                      원가/URL 중심
                    </button>
                  </div>
                </div>
                <div className="grid max-h-60 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
                  {['품목코드', ...SELECTABLE_HEADERS].map((header) => (
                    <label key={header} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={downloadHeaders.includes(header)}
                        disabled={header === '품목코드'}
                        onChange={() => toggleDownloadHeader(header)}
                      />
                      {header}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-md border p-3">
                <span className="text-xs font-medium text-muted-foreground">추가 정보</span>
                <div className="mt-2 grid gap-1 sm:grid-cols-3">
                  {EXTRA_DOWNLOAD_HEADERS.map((header) => (
                    <label key={header} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={downloadExtraHeaders.includes(header)}
                        onChange={() => toggleDownloadExtraHeader(header)}
                      />
                      {header}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <a
                  href={downloadUrl(true)}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
                >
                  <FileSpreadsheet className="size-4" />
                  업로드 양식
                </a>
                <a
                  href={downloadUrl(false)}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Download className="size-4" />
                  선택 항목 다운로드
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {uploadOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-4 pt-16" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl rounded-md border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-base font-semibold">품목 엑셀 업로드</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">상품코드 기준으로 필요한 값만 추가하거나 업데이트합니다.</p>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={close} aria-label="닫기">
                <X />
              </Button>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-[320px_1fr]">
              <section className="space-y-4">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">업로드 방식</span>
                  <select
                    value={mode}
                    onChange={(event) => {
                      setMode(event.target.value as ImportMode)
                      setPreview(null)
                    }}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    <option value="cost-url-and-new">신상품 추가 + 원가/URL 업데이트</option>
                    <option value="new-only">신상품만 추가</option>
                    <option value="selected">선택 컬럼만 업데이트</option>
                  </select>
                </label>

                {mode === 'selected' ? (
                  <div className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">반영할 컬럼</span>
                      <button
                        type="button"
                        className="text-xs font-medium text-primary hover:underline"
                        onClick={() => {
                          setSelectedHeaders(DEFAULT_SELECTED_HEADERS)
                          setPreview(null)
                        }}
                      >
                        원가/URL 선택
                      </button>
                    </div>
                    <div className="grid max-h-52 gap-1 overflow-y-auto pr-1">
                      {SELECTABLE_HEADERS.map((header) => (
                        <label key={header} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={selectedHeaders.includes(header)}
                            onChange={() => toggleHeader(header)}
                          />
                          {header}
                        </label>
                      ))}
                    </div>
                    <label className="mt-3 flex items-center gap-2 border-t pt-3 text-xs">
                      <input
                        type="checkbox"
                        checked={createMissing}
                        onChange={(event) => {
                          setCreateMissing(event.target.checked)
                          setPreview(null)
                        }}
                      />
                      없는 상품코드는 신상품으로 추가
                    </label>
                  </div>
                ) : null}

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">엑셀 파일</span>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="h-9 w-full rounded-md border bg-background px-2 py-1 text-sm"
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null)
                      setPreview(null)
                    }}
                  />
                </label>

                <div className="rounded-md bg-muted/45 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">안전 규칙</p>
                  <p className="mt-1">빈칸은 기존값 유지, 선택한 컬럼만 수정, 엑셀 업로드로 기존 품목 삭제는 하지 않습니다.</p>
                </div>

                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={requestPreview} disabled={isPending || !file}>
                    {isPending ? '확인 중' : '미리보기'}
                  </Button>
                  <Button type="button" onClick={applyImport} disabled={isPending || !canApply}>
                    {isPending ? '반영 중' : '최종 반영'}
                  </Button>
                </div>
              </section>

              <section className="min-h-80 rounded-md border">
                <div className="border-b px-4 py-3">
                  <h3 className="text-sm font-semibold">미리보기</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">반영 전 변경 건수를 먼저 확인합니다.</p>
                </div>

                {preview ? (
                  <div className="space-y-4 p-4">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <PreviewMetric label="신규 추가" value={preview.newItems} />
                      <PreviewMetric label="변경 품목" value={preview.changedItems} />
                      <PreviewMetric label="변경 없음" value={preview.unchangedItems} />
                      <PreviewMetric label="제외/오류" value={preview.skipped + preview.invalidNewItems} tone={preview.skipped + preview.invalidNewItems > 0 ? 'warn' : 'normal'} />
                    </div>

                    <div className="rounded-md border p-3 text-xs">
                      <div className="grid gap-1 sm:grid-cols-2">
                        <PreviewLine label="엑셀 전체 행" value={preview.total} />
                        <PreviewLine label="상품코드 인식" value={preview.parsed} />
                        <PreviewLine label="기존상품 검사" value={preview.updateItems} />
                        <PreviewLine label="기존상품 건너뜀" value={preview.skippedExisting} />
                        <PreviewLine label="신규인데 품목명 없음" value={preview.invalidNewItems} />
                        {preview.imported != null ? <PreviewLine label="이번 반영 완료" value={preview.imported} strong /> : null}
                      </div>
                    </div>

                    {Object.values(preview.fieldChanges).some((count) => count > 0) ? (
                      <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">컬럼별 변경</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(preview.fieldChanges)
                            .filter(([, count]) => count > 0)
                            .map(([header, count]) => (
                              <span key={header} className="rounded-full border bg-muted px-2 py-1 text-xs">
                                {header} {count.toLocaleString('ko-KR')}
                              </span>
                            ))}
                        </div>
                      </div>
                    ) : null}

                    {preview.sampleChanges.length > 0 ? (
                      <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">샘플</p>
                        <div className="overflow-hidden rounded-md border">
                          <table className="w-full text-xs">
                            <thead className="bg-muted">
                              <tr>
                                <th className="px-2 py-2 text-left font-medium">구분</th>
                                <th className="px-2 py-2 text-left font-medium">품목코드</th>
                                <th className="px-2 py-2 text-left font-medium">품목명</th>
                                <th className="px-2 py-2 text-left font-medium">변경</th>
                              </tr>
                            </thead>
                            <tbody>
                              {preview.sampleChanges.map((sample) => (
                                <tr key={`${sample.type}-${sample.sku}`} className="border-t">
                                  <td className="whitespace-nowrap px-2 py-2">{sampleTypeLabel(sample.type)}</td>
                                  <td className="whitespace-nowrap px-2 py-2 font-mono">{sample.sku}</td>
                                  <td className="max-w-44 truncate px-2 py-2">{sample.name || '-'}</td>
                                  <td className="px-2 py-2 text-muted-foreground">{sample.changedHeaders.slice(0, 4).join(', ')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        <CheckCircle2 className="size-4" />
                        반영할 변경사항이 없습니다.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-80 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                    <AlertTriangle className="size-5" />
                    파일과 업로드 방식을 선택한 뒤 미리보기를 눌러주세요.
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function PreviewMetric({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'warn' }) {
  return (
    <div className={`rounded-md border p-3 ${tone === 'warn' ? 'border-destructive/30 bg-destructive/5' : ''}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value.toLocaleString('ko-KR')}</p>
    </div>
  )
}

function PreviewLine({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold text-primary' : 'font-medium'}>{value.toLocaleString('ko-KR')}</span>
    </div>
  )
}

function sampleTypeLabel(type: ImportPreview['sampleChanges'][number]['type']) {
  if (type === 'new') return '신규'
  if (type === 'invalid-new') return '확인필요'
  return '변경'
}
