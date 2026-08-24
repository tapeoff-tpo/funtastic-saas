'use client'

import { useState, useTransition, type DragEvent } from 'react'
import { AlertTriangle, Check, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PreviewSection = { rows: number; quantity: number; samples: Array<{ sku: string; productName: string; quantity: number }> }
type InventoryPreview = { total: number; success: number; failed: number; errors?: Array<{ sku: string; error: string }> }
type StoredFiles = Partial<Record<FileKey, { fileName: string; updatedAt: string }>>
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
  { key: 'purchaseRequest', label: '발주요청현황', detail: '아직 구매되지 않은 구매요청 건' },
  { key: 'purchasePlan', label: '발주계획현황', detail: '구매중으로 넘어간 발주계획 건' },
  { key: 'purchaseHistory', label: '구매현황', detail: '구매되어 중국창고에 도착한 건' },
  { key: 'chinaInventory', label: '중국재고현황', detail: '현재 중국창고에 보유한 재고' },
  { key: 'chinaOutbound', label: '중국출고현황', detail: '한국으로 출고 중이거나 완료된 건' },
  { key: 'domesticInventory', label: '국내재고현황', detail: '재고관리에 반영할 국내 창고 현재고' },
] as const
type FileKey = (typeof REQUIRED_FILES)[number]['key']

export function PurchasingRawDataUpload({ today, inventoryUpdatedDate, initialStoredFiles }: { today: string; inventoryUpdatedDate: string; initialStoredFiles: StoredFiles }) {
  const [files, setFiles] = useState<Partial<Record<FileKey, File>>>({})
  const [storedFiles, setStoredFiles] = useState(initialStoredFiles)
  const [preview, setPreview] = useState<SnapshotSummary | null>(null)
  const [inventoryPreview, setInventoryPreview] = useState<InventoryPreview | null>(null)
  const [previewKinds, setPreviewKinds] = useState<FileKey[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<FileKey | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedFiles = REQUIRED_FILES.flatMap(({ key }) => files[key] ? [files[key]!] : [])
  const selectedPurchasingFiles = REQUIRED_FILES.flatMap(({ key }) => key !== 'domesticInventory' && files[key] ? [files[key]!] : [])
  const domesticInventoryFile = files.domesticInventory
  const readyCount = REQUIRED_FILES.filter(({ key }) => files[key] || storedFiles[key]).length
  const isVerified = Boolean(preview || inventoryPreview)

  function selectFile(key: FileKey, file?: File) {
    if (file && !/\.xlsx$/i.test(file.name)) {
      setError('엑셀 파일(.xlsx)만 넣을 수 있습니다.')
      return
    }
    setFiles((current) => ({ ...current, [key]: file }))
    setPreview(null)
    setInventoryPreview(null)
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
        let purchasingBody: { error?: string; summary?: SnapshotSummary; storedFiles?: StoredFiles; changedKinds?: FileKey[] } | null = null
        let domesticBody: (InventoryPreview & { error?: string }) | null = null

        if (selectedPurchasingFiles.length > 0) {
          const form = new FormData()
          form.set('mode', mode)
          form.set('asOfDate', today)
          form.set('domesticInventoryReflectedThrough', inventoryUpdatedDate)
          form.set('purchasePlanConfirmedSince', '2026-07-01')
          for (const file of selectedPurchasingFiles) form.append('files', file)
          const response = await fetch('/api/purchasing/raw-data', { method: 'POST', body: form })
          purchasingBody = await readJsonResponse<NonNullable<typeof purchasingBody>>(response, '발주 로우데이터를 처리하지 못했습니다.')
          if (purchasingBody.storedFiles) setStoredFiles(purchasingBody.storedFiles)
          if (!response.ok || !purchasingBody.summary) throw new Error(purchasingBody.error ?? '발주 로우데이터를 처리하지 못했습니다.')
          if (mode === 'preview') {
            const filesByName = new Map(selectedPurchasingFiles.map((file) => [file.name, file]))
            setFiles((current) => Object.fromEntries(REQUIRED_FILES.map(({ key }) => [
              key,
              key === 'domesticInventory' ? current[key] : filesByName.get(purchasingBody!.summary!.files[key]),
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
          domesticBody = await readJsonResponse<NonNullable<typeof domesticBody>>(response, '국내재고 파일을 처리하지 못했습니다.')
          if (!response.ok || domesticBody.failed > 0) {
            const detail = domesticBody.errors?.slice(0, 3).map((item) => `${item.sku}: ${item.error}`).join(' / ')
            throw new Error(domesticBody.error ?? detail ?? '국내재고 파일을 처리하지 못했습니다.')
          }
          setInventoryPreview(domesticBody)
        }

        if (mode === 'apply') {
          setFiles({})
          setMessage(domesticInventoryFile && selectedPurchasingFiles.length === 0
            ? '국내재고가 재고관리에 반영되었습니다.'
            : domesticInventoryFile
              ? '발주 로우데이터와 국내재고 반영이 완료되었습니다.'
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
            <p className="mt-1 text-sm text-muted-foreground">변경할 파일만 넣으면 됩니다. 국내재고 파일은 최종 반영 시 재고관리에 바로 적용됩니다.</p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">{readyCount} / 6 준비 · {selectedFiles.length}개 변경</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {REQUIRED_FILES.map(({ key, label, detail }, index) => {
            const file = files[key]
            const stored = storedFiles[key]
            const recognized = preview?.files[key]
            const matches = !recognized || recognized === file?.name
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
                  <span className={`mt-3 block truncate text-sm ${file ? 'font-medium text-emerald-800' : stored ? 'text-sky-800' : 'text-muted-foreground'}`}>{file?.name ?? (stored ? `저장됨: ${stored.fileName}` : '여기에 드래그하거나 클릭해서 .xlsx 선택')}</span>
                  {recognized ? <span className={`mt-1 block text-xs ${matches ? 'text-emerald-700' : 'text-destructive'}`}>{matches ? '파일 종류 확인 완료' : `이 칸의 파일과 실제 종류가 다릅니다: ${recognized}`}</span> : null}
                </span>
                {file ? <button type="button" aria-label={`${label} 파일 제거`} className="rounded p-1 hover:bg-background" onClick={(event) => { event.preventDefault(); selectFile(key) }}><X className="size-4" /></button> : <FileSpreadsheet className="size-5 text-muted-foreground" />}
                <input type="file" accept=".xlsx" className="sr-only" onChange={(event) => selectFile(key, event.target.files?.[0])} />
              </label>
            )
          })}
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

      <section className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>최종 반영은 선택한 항목만 교체합니다. 국내재고 파일을 선택하면 재고관리 현재고를 갱신하며, 수동 입력한 발주와 발주검토 항목은 삭제하지 않습니다.</p>
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
