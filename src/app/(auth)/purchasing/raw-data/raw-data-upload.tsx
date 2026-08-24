'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type SyncState = { purchaseRows: number; chinaRows: number; chinaQuantity: number }
type PreviewSection = { rows: number; quantity: number; samples: Array<{ sku: string; productName: string; quantity: number }> }
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
  '발주요청현황(구매요청)',
  '발주계획현황(구매중)',
  '구매현황(중국도착)',
  '중국재고현황(중국현재고)',
  '중국출고현황(한국도착예정)',
] as const

export function PurchasingRawDataUpload({ initialState, today }: { initialState: SyncState; today: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [asOfDate, setAsOfDate] = useState(today)
  const [domesticThrough, setDomesticThrough] = useState(today)
  const [planSince, setPlanSince] = useState('2026-07-01')
  const [preview, setPreview] = useState<SnapshotSummary | null>(null)
  const [state, setState] = useState(initialState)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedKey = useMemo(() => files.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join('|'), [files])

  function selectFiles(nextFiles: File[]) {
    setFiles(nextFiles)
    setPreview(null)
    setMessage(null)
    setError(null)
  }

  function submit(mode: 'preview' | 'apply') {
    if (files.length !== 5) {
      setError('필수 원본 파일 5개를 모두 선택해주세요.')
      return
    }
    if (mode === 'apply' && !preview) {
      setError('먼저 미리보기로 파일 검증을 완료해주세요.')
      return
    }
    setError(null)
    setMessage(null)
    startTransition(async () => {
      try {
        const form = new FormData()
        form.set('mode', mode)
        form.set('asOfDate', asOfDate)
        form.set('domesticInventoryReflectedThrough', domesticThrough)
        form.set('purchasePlanConfirmedSince', planSince)
        for (const file of files) form.append('files', file)
        const response = await fetch('/api/purchasing/raw-data', { method: 'POST', body: form })
        const body = await response.json().catch(() => ({})) as { error?: string; summary?: SnapshotSummary; currentState?: SyncState }
        if (!response.ok || !body.summary) {
          setError(body.error ?? '발주 로우데이터를 처리하지 못했습니다.')
          return
        }
        setPreview(body.summary)
        if (body.currentState) setState(body.currentState)
        if (mode === 'apply') {
          setMessage('발주 로우데이터 반영이 완료되었습니다. 이제 발주검토에서 추천계산을 다시 실행해주세요.')
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
      <section className="grid gap-3 sm:grid-cols-3">
        <StateCard label="현재 발주 진행" value={`${state.purchaseRows.toLocaleString('ko-KR')}행`} />
        <StateCard label="현재 중국재고 SKU" value={`${state.chinaRows.toLocaleString('ko-KR')}개`} />
        <StateCard label="현재 중국재고 수량" value={`${state.chinaQuantity.toLocaleString('ko-KR')}개`} />
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h2 className="font-semibold">1. 원본 파일 선택</h2>
        <p className="mt-1 text-sm text-muted-foreground">파일명은 달라도 괜찮으며, 첫 시트의 헤더를 읽어 종류를 자동 판별합니다.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {REQUIRED_FILES.map((label) => <div key={label} className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"><FileSpreadsheet className="size-4 text-muted-foreground" />{label}</div>)}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="mt-4 block w-full rounded-md border border-input px-3 py-2 text-sm"
          onChange={(event) => selectFiles(Array.from(event.target.files ?? []))}
        />
        <div className="mt-2 text-xs text-muted-foreground">선택: {files.length}개 · {selectedKey ? files.map((file) => file.name).join(', ') : '없음'}</div>
      </section>

      <section className="rounded-lg border bg-background p-4">
        <h2 className="font-semibold">2. 기준일 설정</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <DateField label="Ecount 기준일" value={asOfDate} onChange={(value) => { setAsOfDate(value); setPreview(null) }} />
          <DateField label="국내재고 반영 기준일" value={domesticThrough} onChange={(value) => { setDomesticThrough(value); setPreview(null) }} />
          <DateField label="완료 발주계획 시작일" value={planSince} onChange={(value) => { setPlanSince(value); setPreview(null) }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">국내재고 반영 기준일까지 한국 출고가 끝난 중국출고 건은 완료로 처리합니다. 완료 발주계획 시작일은 기존 이력 연결 기준인 2026-07-01을 유지합니다.</p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={isPending} onClick={() => submit('preview')}>
          {isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}미리보기·검증
        </Button>
        <Button type="button" disabled={isPending || !preview} onClick={() => submit('apply')}>
          {isPending ? <Loader2 className="animate-spin" /> : <Upload />}최종 반영
        </Button>
        {message ? <span className="text-sm text-emerald-700">{message}</span> : null}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>

      {preview ? <Preview summary={preview} /> : null}

      <section className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>최종 반영은 이전에 SaaS 원본 업로드로 생성된 발주 진행·중국재고 스냅샷을 새 파일 내용으로 교체합니다. 수동 입력한 발주와 발주검토 항목은 삭제하지 않습니다.</p>
      </section>
    </div>
  )
}

function Preview({ summary }: { summary: SnapshotSummary }) {
  const sections = [
    ['발주요청(구매요청)', summary.activeRequests],
    ['구매완료·구매중', summary.purchaseCompleted],
    ['중국현재고', summary.chinaInventory],
    ['한국출고 진행', summary.outboundPending],
    ['중국출고 완료', summary.outboundCompleted],
  ] as const
  return (
    <section className="rounded-lg border bg-background p-4">
      <h2 className="font-semibold">3. 반영 미리보기</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {sections.map(([label, section]) => <StateCard key={label} label={label} value={`${section.rows.toLocaleString('ko-KR')}행 / ${section.quantity.toLocaleString('ko-KR')}개`} />)}
      </div>
      {summary.warnings.length > 0 ? <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{summary.warnings.map((warning) => <p key={warning}>• {warning}</p>)}</div> : null}
    </section>
  )
}

function StateCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-sm"><span className="font-medium">{label}</span><Input type="date" value={value} onChange={(event) => onChange(event.target.value)} /></label>
}
