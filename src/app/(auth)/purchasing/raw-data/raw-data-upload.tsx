'use client'

import { useState, useTransition, type DragEvent } from 'react'
import { AlertTriangle, Check, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PreviewSection = { rows: number; quantity: number; samples: Array<{ sku: string; productName: string; quantity: number }> }
type InventoryPreview = { total: number; success: number; failed: number; errors?: Array<{ sku: string; error: string }> }
type DataFreshness = {
  rawDataAppliedAt: string | null
  domesticInventoryAt: string | null
  chinaInventoryAt: string | null
  outboundRawAt: string | null
  outboundReflectionAt: string | null
}
type StoredFiles = Partial<Record<FileKey, { fileName: string; updatedAt: string }>>
type PurchasingUploadResponse = {
  error?: string
  summary?: SnapshotSummary
  storedFiles?: StoredFiles
  changedKinds?: FileKey[]
}
type DomesticInventoryResponse = InventoryPreview & { error?: string }
type DiscontinuedPreview = {
  fileName: string
  totalDataRows: number
  uniqueSkuCount: number
  discontinuedSkuCount: number
  restoredSkuCount: number
  duplicateSkus: string[]
  registeredSkuCount: number
  unregisteredSkus: string[]
}
type DiscontinuedUploadResponse = {
  error?: string
  summary?: DiscontinuedPreview
  storedFile?: { fileName: string; updatedAt: string } | null
}
type SnapshotSummary = {
  asOfDate: string
  domesticInventoryReflectedThrough: string
  purchasePlanConfirmedSince: string
  files: Record<string, string>
  activeRequests: PreviewSection
  purchaseCompleted: PreviewSection & { confirmedPlanRows: number }
  chinaInventory: PreviewSection
  outboundCompleted: PreviewSection
  outboundPending: PreviewSection
  warnings: string[]
}

const REQUIRED_FILES = [
  { key: 'purchaseRequest', label: '발주요청현황', detail: '아직 구매되지 않은 구매요청 건', uploadRule: '이력 누적 · 마지막 반영분 이후 신규/변경분' },
  { key: 'purchasePlan', label: '발주계획현황', detail: '구매중으로 넘어간 발주계획 건', uploadRule: '이력 누적 · 마지막 반영분 이후 신규/변경분' },
  { key: 'purchaseHistory', label: '구매현황', detail: '구매되어 중국창고에 도착한 건', uploadRule: '이력 누적 · 마지막 반영분 이후 신규/변경분' },
  { key: 'chinaInventory', label: '중국재고현황', detail: '현재 중국창고에 보유한 재고', uploadRule: '현재 전체본 · 중국창고 재고 전체' },
  { key: 'chinaOutbound', label: '중국출고현황', detail: '한국으로 출고 중이거나 완료된 건 · 구입관리코드 포함 시 주문서번호 없는 건도 연결', uploadRule: '이력 누적 · 마지막 반영분 이후 신규/변경분' },
  { key: 'domesticInventory', label: '국내재고현황', detail: '재고관리에 반영할 국내 창고 현재고', uploadRule: '현재 전체본 · 국내 창고 재고 전체' },
  { key: 'discontinuedProducts', label: '단종상품 현황', detail: '단종 또는 해제할 품목의 발주 상태', uploadRule: '변경 목록 · 파일에 적은 SKU만 상태 변경', templateHref: '/api/purchasing/discontinued-products/template' },
] as const
type FileKey = (typeof REQUIRED_FILES)[number]['key']

export function PurchasingRawDataUpload({ today, inventoryUpdatedDate, initialStoredFiles, dataFreshness }: { today: string; inventoryUpdatedDate: string; initialStoredFiles: StoredFiles; dataFreshness: DataFreshness }) {
  const [files, setFiles] = useState<Partial<Record<FileKey, File>>>({})
  const [storedFiles, setStoredFiles] = useState(initialStoredFiles)
  const [preview, setPreview] = useState<SnapshotSummary | null>(null)
  const [inventoryPreview, setInventoryPreview] = useState<InventoryPreview | null>(null)
  const [discontinuedPreview, setDiscontinuedPreview] = useState<DiscontinuedPreview | null>(null)
  const [previewKinds, setPreviewKinds] = useState<FileKey[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<FileKey | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedFiles = REQUIRED_FILES.flatMap(({ key }) => files[key] ? [files[key]!] : [])
  const selectedPurchasingFiles = REQUIRED_FILES.flatMap(({ key }) => (
    key !== 'domesticInventory' && key !== 'discontinuedProducts' && files[key] ? [files[key]!] : []
  ))
  const domesticInventoryFile = files.domesticInventory
  const discontinuedProductFile = files.discontinuedProducts
  const readyCount = REQUIRED_FILES.filter(({ key }) => files[key] || storedFiles[key]).length
  const isVerified = Boolean(preview || inventoryPreview || discontinuedPreview)

  function selectFile(key: FileKey, file?: File) {
    if (file && !/\.xlsx$/i.test(file.name)) {
      setError('엑셀 파일(.xlsx)만 넣을 수 있습니다.')
      return
    }
    setFiles((current) => ({ ...current, [key]: file }))
    setPreview(null)
    setInventoryPreview(null)
    setDiscontinuedPreview(null)
    setPreviewKinds([])
    setMessage(null)
    setError(null)
  }

  function dropFile(event: DragEvent<HTMLLabelElement>, key: FileKey) {
    event.preventDefault()
    setDragOver(null)
    selectFile(key, event.dataTransfer.files[0])
  }

  function submit(mode: 'preview' | 'apply') {
    if (selectedFiles.length === 0) {
      setError('변경할 파일을 하나 이상 선택해주세요.')
      return
    }
    if (mode === 'apply' && !isVerified) {
      setError('먼저 미리보기로 파일 검증을 완료해주세요.')
      return
    }
    setError(null)
    setMessage(null)
    startTransition(async () => {
      try {
        let purchasingBody: PurchasingUploadResponse | null = null
        let domesticBody: DomesticInventoryResponse | null = null
        let discontinuedBody: DiscontinuedUploadResponse | null = null

        if (selectedPurchasingFiles.length > 0) {
          const form = new FormData()
          form.set('mode', mode)
          form.set('asOfDate', today)
          form.set('domesticInventoryReflectedThrough', inventoryUpdatedDate)
          form.set('purchasePlanConfirmedSince', '2026-07-01')
          for (const file of selectedPurchasingFiles) form.append('files', file)
          const response = await fetch('/api/purchasing/raw-data', { method: 'POST', body: form })
          purchasingBody = await readJsonResponse<PurchasingUploadResponse>(response, '발주 로우데이터를 처리하지 못했습니다.')
          if (mode === 'apply' && purchasingBody.storedFiles) setStoredFiles(purchasingBody.storedFiles)
          if (!response.ok || !purchasingBody.summary) throw new Error(purchasingBody.error ?? '발주 로우데이터를 처리하지 못했습니다.')
          if (mode === 'preview') {
            const filesByName = new Map(selectedPurchasingFiles.map((file) => [file.name, file]))
            setFiles((current) => Object.fromEntries(REQUIRED_FILES.map(({ key }) => [
              key,
              key === 'domesticInventory' || key === 'discontinuedProducts'
                ? current[key]
                : filesByName.get(purchasingBody!.summary!.files[key]),
            ])))
          }
          setPreview(purchasingBody.summary)
          setPreviewKinds(purchasingBody.changedKinds ?? [])
        }

        if (domesticInventoryFile) {
          const inventoryForm = new FormData()
          inventoryForm.set('mode', mode)
          inventoryForm.set('file', domesticInventoryFile)
          const response = await fetch('/api/inventory/bulk-upload', { method: 'POST', body: inventoryForm })
          domesticBody = await readJsonResponse<DomesticInventoryResponse>(response, '국내재고 파일을 처리하지 못했습니다.')
          if (!response.ok || domesticBody.failed > 0) {
            const detail = domesticBody.errors?.slice(0, 3).map((item) => `${item.sku}: ${item.error}`).join(' / ')
            throw new Error(domesticBody.error ?? detail ?? '국내재고 파일을 처리하지 못했습니다.')
          }
          setInventoryPreview(domesticBody)
        }

        if (discontinuedProductFile) {
          const discontinuedForm = new FormData()
          discontinuedForm.set('mode', mode)
          discontinuedForm.set('file', discontinuedProductFile)
          const response = await fetch('/api/purchasing/discontinued-products', { method: 'POST', body: discontinuedForm })
          discontinuedBody = await readJsonResponse<DiscontinuedUploadResponse>(response, '단종상품 파일을 처리하지 못했습니다.')
          if (!response.ok || !discontinuedBody.summary) {
            throw new Error(discontinuedBody.error ?? '단종상품 파일을 처리하지 못했습니다.')
          }
          if (mode === 'apply' && discontinuedBody.storedFile) {
            setStoredFiles((current) => ({ ...current, discontinuedProducts: discontinuedBody!.storedFile! }))
          }
          setDiscontinuedPreview(discontinuedBody.summary)
        }

        if (mode === 'apply') {
          setFiles({})
          setMessage(discontinuedProductFile && selectedPurchasingFiles.length === 0 && !domesticInventoryFile
            ? '단종상품 상태가 반영되었습니다. 발주검토에서 추천계산을 다시 실행해주세요.'
            : domesticInventoryFile && selectedPurchasingFiles.length === 0 && !discontinuedProductFile
            ? '국내재고가 재고관리에 반영되었습니다.'
            : domesticInventoryFile || discontinuedProductFile
              ? '선택한 발주 로우데이터가 반영되었습니다. 발주검토에서 추천계산을 다시 실행해주세요.'
              : '발주 로우데이터 반영이 완료되었습니다. 이제 발주검토에서 추천계산을 다시 실행해주세요.')
        } else {
          setMessage('파일 검증이 완료되었습니다. 아래 내역을 확인한 뒤 최종 반영하세요.')
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : '발주 로우데이터를 처리하지 못했습니다.')
      }
    })
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">1. 파일별로 업로드</h2>
            <p className="mt-1 text-sm text-muted-foreground">이력 파일은 마지막 반영분 이후만 넣으면 서버 누적본에 합쳐집니다. 중국·국내재고는 전체 최신본, 단종상품은 변경할 SKU만 넣으세요.</p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">{readyCount} / 7 준비 · {selectedFiles.length}개 변경</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {REQUIRED_FILES.map(({ key, label, detail, uploadRule, templateHref }, index) => {
            const file = files[key]
            const stored = storedFiles[key]
            const recognized = key === 'discontinuedProducts'
              ? discontinuedPreview?.fileName
              : preview?.files[key]
            const displayedFileName = file?.name ?? stored?.fileName
            const matches = !recognized || recognized === displayedFileName
            return (
              <label
                key={key}
                className={`relative flex min-h-28 cursor-pointer gap-3 rounded-lg border-2 border-dashed p-4 transition-colors hover:bg-muted/30 ${dragOver === key ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : file ? 'border-emerald-300 bg-emerald-50/50' : stored ? 'border-sky-200 bg-sky-50/40' : 'border-muted-foreground/25'}`}
                onDragEnter={(event) => { event.preventDefault(); setDragOver(key) }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(null) }}
                onDrop={(event) => dropFile(event, key)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">{file || stored ? <Check className={`size-4 ${file ? 'text-emerald-700' : 'text-sky-700'}`} /> : index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
                  <span className="mt-1 block text-xs font-medium text-sky-800">{uploadRule}</span>
                  {templateHref ? <a href={templateHref} className="mt-1 inline-block text-xs font-medium text-primary underline underline-offset-2" onClick={(event) => event.stopPropagation()}>단종상품 양식 다운로드</a> : null}
                  <span className={`mt-3 block truncate text-sm ${file ? 'font-medium text-emerald-800' : stored ? 'text-sky-800' : 'text-muted-foreground'}`}>{file?.name ?? (stored ? `저장됨: ${stored.fileName}` : '여기에 드래그하거나 클릭해서 .xlsx 선택')}</span>
                  {!file && stored ? <span className="mt-1 block text-xs text-muted-foreground">마지막 등록: {formatKstTimestamp(stored.updatedAt)}</span> : null}
                  {key === 'domesticInventory' && !file ? <span className="mt-1 block text-xs text-muted-foreground">마지막 반영: {formatKstTimestamp(dataFreshness.domesticInventoryAt)}</span> : null}
                  {recognized ? <span className={`mt-1 block text-xs ${matches ? 'text-emerald-700' : 'text-destructive'}`}>{matches ? '파일 종류 확인 완료' : `이 칸의 파일과 실제 종류가 다릅니다: ${recognized}`}</span> : null}
                </span>
                {file ? <button type="button" aria-label={`${label} 파일 제거`} className="rounded p-1 hover:bg-background" onClick={(event) => { event.preventDefault(); selectFile(key) }}><X className="size-4" /></button> : <FileSpreadsheet className="size-5 text-muted-foreground" />}
                <input type="file" accept=".xlsx" className="sr-only" onChange={(event) => selectFile(key, event.target.files?.[0])} />
              </label>
            )
          })}
        </div>
      </section>

      <section className="rounded-lg border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <h2 className="font-medium text-foreground">연결 데이터 기준</h2>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <span>발주 로우데이터 {formatKstTimestamp(dataFreshness.rawDataAppliedAt)}</span>
          <span>국내재고 {formatKstTimestamp(dataFreshness.domesticInventoryAt)}</span>
          <span>중국재고 {formatKstTimestamp(dataFreshness.chinaInventoryAt)}</span>
          <span>중국출고 {formatKstTimestamp(dataFreshness.outboundRawAt)}</span>
          <span>출고반영 {formatKstTimestamp(dataFreshness.outboundReflectionAt)}</span>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={isPending || selectedFiles.length === 0} onClick={() => submit('preview')}>
          {isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}미리보기·검증
        </Button>
        <Button type="button" disabled={isPending || !isVerified} onClick={() => submit('apply')}>
          {isPending ? <Loader2 className="animate-spin" /> : <Upload />}최종 반영
        </Button>
        {message ? <span className="text-sm text-emerald-700">{message}</span> : null}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>

      {preview ? <Preview summary={preview} kinds={previewKinds} /> : null}
      {inventoryPreview ? <section className="rounded-lg border bg-background p-4"><h2 className="font-semibold">국내재고 미리보기</h2><div className="mt-3 grid gap-3 sm:grid-cols-3"><StateCard label="전체 행" value={`${inventoryPreview.total.toLocaleString('ko-KR')}건`} /><StateCard label="정상" value={`${inventoryPreview.success.toLocaleString('ko-KR')}건`} /><StateCard label="오류" value={`${inventoryPreview.failed.toLocaleString('ko-KR')}건`} /></div></section> : null}
      {discontinuedPreview ? <DiscontinuedPreviewCard summary={discontinuedPreview} /> : null}

      <section className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          발주요청·발주계획·구매현황·중국출고는 새 기간만 올려도 기존 누적 이력에 합쳐지며, 같은 건은 새 파일 값으로 갱신됩니다.
          수정 가능성이 있는 최근 7일은 함께 올리면 더 정확합니다. 중국출고에는 구입관리코드 열을 함께 넣으면 주문서번호 없는 건도 구매현황과 정확히 연결합니다. 중국·국내재고는 반드시 전체 최신본을 올리세요. 단종상품은 단종/해제할 SKU만 올리며, 파일에 없는 SKU는 기존 상태를 유지합니다. 미리보기만으로는 저장·반영되지 않으며, 수동 입력한 발주와 발주검토 항목은 삭제하지 않습니다.
        </p>
      </section>
    </div>
  )
}

function Preview({ summary, kinds }: { summary: SnapshotSummary; kinds: FileKey[] }) {
  const sections = [
    ['purchaseRequest', '발주요청(구매요청)', summary.activeRequests],
    ['purchasePlan', '구매완료·구매중', summary.purchaseCompleted],
    ['chinaInventory', '중국현재고', summary.chinaInventory],
    ['chinaOutbound', '한국출고 진행', summary.outboundPending],
    ['chinaOutbound', '중국출고 완료', summary.outboundCompleted],
  ] as const
  const visibleSections = sections.filter(([kind]) => (
    kinds.includes(kind) || (kind === 'purchasePlan' && kinds.includes('purchaseHistory'))
  ))
  const warnings = summary.warnings.filter((warning) => (
    (kinds.includes('purchaseRequest') && warning.startsWith('진행중 발주요청'))
    || (kinds.includes('chinaInventory') && warning.startsWith('중국창고 재고'))
    || (kinds.includes('chinaOutbound') && warning.startsWith('중국출고'))
  ))
  return (
    <section className="rounded-lg border bg-background p-4">
      <h2 className="font-semibold">이번에 변경할 항목 미리보기</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {visibleSections.map(([, label, section]) => <StateCard key={label} label={label} value={`${section.rows.toLocaleString('ko-KR')}행 / ${section.quantity.toLocaleString('ko-KR')}개`} />)}
      </div>
      {warnings.length > 0 ? <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{warnings.map((warning) => <p key={warning}>• {warning}</p>)}</div> : null}
    </section>
  )
}

function DiscontinuedPreviewCard({ summary }: { summary: DiscontinuedPreview }) {
  return (
    <section className="rounded-lg border bg-background p-4">
      <h2 className="font-semibold">단종상품 미리보기</h2>
      <p className="mt-1 text-sm text-muted-foreground">파일에 적힌 SKU만 바뀝니다. 단종은 발주추천과 자동추천에서 제외되고, 해제는 정상 발주 상태로 되돌립니다.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StateCard label="처리 대상 SKU" value={`${summary.uniqueSkuCount.toLocaleString('ko-KR')}개`} />
        <StateCard label="단종 처리" value={`${summary.discontinuedSkuCount.toLocaleString('ko-KR')}개`} />
        <StateCard label="단종 해제" value={`${summary.restoredSkuCount.toLocaleString('ko-KR')}개`} />
        <StateCard label="품목 등록 확인" value={`${summary.registeredSkuCount.toLocaleString('ko-KR')}개`} />
        <StateCard label="미등록 SKU" value={`${summary.unregisteredSkus.length.toLocaleString('ko-KR')}개`} />
      </div>
      {summary.duplicateSkus.length > 0 ? <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">• 중복 SKU {summary.duplicateSkus.length}개는 마지막 행의 단종여부로 반영됩니다: {summary.duplicateSkus.slice(0, 8).join(', ')}{summary.duplicateSkus.length > 8 ? ' …' : ''}</div> : null}
      {summary.unregisteredSkus.length > 0 ? <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">• 품목에 없는 SKU {summary.unregisteredSkus.length}개는 새로 만들지 않고 건너뜁니다: {summary.unregisteredSkus.slice(0, 8).join(', ')}{summary.unregisteredSkus.length > 8 ? ' …' : ''}</div> : null}
    </section>
  )
}

function StateCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>
}

async function readJsonResponse<T extends { error?: string }>(response: Response, fallback: string): Promise<T> {
  const responseText = await response.text()
  try {
    return (responseText ? JSON.parse(responseText) : {}) as T
  } catch {
    return { error: response.status === 413
      ? '업로드 용량이 서버 한도를 초과했습니다. 파일을 나누어 올려주세요.'
      : `${fallback} (HTTP ${response.status})` } as T
  }
}

function formatKstTimestamp(value: string | null) {
  if (!value) return '기록 없음'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '기록 없음'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}
