'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ExternalLink,
  FileText,
  ImageIcon,
  LayoutTemplate,
  Loader2,
  PackageSearch,
  PencilLine,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import { calculateSalesPrices } from '@/lib/new-products/price-calculator'
import type {
  NewProductAttachment,
  NewProductEditorLayout,
  NewProductEditorSection,
  NewProductItem,
  NewProductStage,
  NewProductStageTone,
  NewProductSummary,
} from '@/lib/new-products/workflow'
import {
  createNewProductAction,
  deleteNewProductAction,
  deleteNewProductsAction,
  saveNewProductEditorLayoutAction,
  saveNewProductStagesAction,
  updateNewProductAction,
} from './actions'

type Props = {
  initialStages: NewProductStage[]
  initialLayout: NewProductEditorLayout
  canManageSettings: boolean
  exchangeRate: CnyKrwReferenceRate
}

const sectionLabels: Record<NewProductEditorSection, string> = {
  progress: '진행 상태',
  basic: '기본 상품 정보',
  itemMaster: '품목 등록 정보',
  attachments: '이미지 및 품질표시 파일',
  notice: '상품정보고시',
  package: '패키지·등록 준비',
  pricing: '원가 및 판매가 계산',
}

const toneClasses: Record<NewProductStageTone, string> = {
  slate: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-100 text-blue-700',
  violet: 'bg-violet-100 text-violet-700',
  cyan: 'bg-cyan-100 text-cyan-700',
  amber: 'bg-amber-100 text-amber-800',
  orange: 'bg-orange-100 text-orange-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  purple: 'bg-purple-100 text-purple-700',
  rose: 'bg-rose-100 text-rose-700',
  teal: 'bg-teal-100 text-teal-700',
  sky: 'bg-sky-100 text-sky-700',
  lime: 'bg-lime-100 text-lime-800',
  emerald: 'bg-emerald-100 text-emerald-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
}

export function NewProductBoard({ initialStages, initialLayout, canManageSettings, exchangeRate }: Props) {
  const router = useRouter()
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [summaries, setSummaries] = useState<NewProductSummary[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [item, setItem] = useState<NewProductItem | null>(null)
  const [mode, setMode] = useState<'view' | 'create'>('view')
  const [editorRevision, setEditorRevision] = useState(0)
  const [dataRevision, setDataRevision] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [layout, setLayout] = useState(initialLayout)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      if (selectedStageIds.length === 0) {
        setSummaries([])
        setTotal(0)
        setListLoading(false)
        return
      }
      setListLoading(true)
      const params = new URLSearchParams()
      selectedStageIds.forEach((stageId) => params.append('stageId', stageId))
      if (query.trim()) params.set('query', query.trim())
      try {
        const response = await fetch(`/api/new-products/items?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        const result = await response.json() as { summaries?: NewProductSummary[]; total?: number; error?: string }
        if (!response.ok) throw new Error(result.error || '상품을 불러오지 못했습니다.')
        const nextSummaries = result.summaries ?? []
        setSummaries(nextSummaries)
        setTotal(result.total ?? 0)
        if (mode === 'view') {
          setSelectedId((current) => current && nextSummaries.some((summary) => summary.id === current)
            ? current
            : null)
        }
      } catch (error) {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : '상품을 불러오지 못했습니다.')
      } finally {
        if (!controller.signal.aborted) setListLoading(false)
      }
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [dataRevision, mode, query, selectedStageIds])

  useEffect(() => {
    if (mode !== 'view' || !selectedId) return
    const controller = new AbortController()
    void fetch(`/api/new-products/items/${selectedId}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { item?: NewProductItem; error?: string }
        if (!response.ok || !result.item) throw new Error(result.error || '상품 상세를 불러오지 못했습니다.')
        setItem(result.item)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : '상품 상세를 불러오지 못했습니다.')
      })
    return () => controller.abort()
  }, [dataRevision, mode, selectedId])

  const detailLoading = mode === 'view' && Boolean(selectedId) && item?.id !== selectedId
  const selectedStageName = selectedStageIds.length === initialStages.length
    ? '전체 상태'
    : selectedStageIds.length === 1
      ? initialStages.find((stage) => stage.id === selectedStageIds[0])?.name ?? '선택 단계'
      : `${selectedStageIds.length}개 단계`

  function selectProduct(id: string) {
    if (!id) return
    setMode('view')
    setSelectedId(id)
    setItem((current) => current?.id === id ? current : null)
  }

  function startNewProduct() {
    setSelectedStageIds([])
    setQuery('')
    setMode('create')
    setSelectedId(null)
    setItem(null)
    setEditorRevision((current) => current + 1)
  }

  function changeStageFilter(stageIds: string[]) {
    setSelectedStageIds(stageIds)
    setMode('view')
    setSelectedId(null)
    setItem(null)
  }

  function closeEditor() {
    setMode('view')
    setSelectedId(null)
    setItem(null)
  }

  function reloadItem(id: string) {
    setMode('view')
    setSelectedId(id)
    setItem(null)
    setDataRevision((current) => current + 1)
    router.refresh()
  }

  function handleDeleted() {
    setMode('view')
    setSelectedId(null)
    setItem(null)
    setDataRevision((current) => current + 1)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-background p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <ToolbarField label="상태별 보기" className="xl:w-64">
            <StageMultiSelect stages={initialStages} selectedIds={selectedStageIds} onChange={changeStageFilter} />
          </ToolbarField>

          <ToolbarField label="상품 검색" className="xl:w-64">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제품명·상품번호" disabled={selectedStageIds.length === 0} className="pl-8" />
            </div>
          </ToolbarField>

          <div className="flex flex-1 flex-wrap justify-end gap-2">
            {(mode === 'create' || selectedId) && <Button variant="outline" onClick={closeEditor}><PackageSearch />{mode === 'create' ? '등록 닫기' : '상품 목록'}</Button>}
            {canManageSettings && <StageSettingsDialog stages={initialStages} onSaved={() => { setDataRevision((current) => current + 1); router.refresh() }} />}
            {canManageSettings && <LayoutSettingsDialog layout={layout} onSaved={setLayout} />}
            <Button onClick={startNewProduct}><Plus />신상품 등록</Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          상태를 선택하면 해당 상품 목록이 표시됩니다. 목록은 최근 수정순 최대 50개까지 불러옵니다.
        </p>
      </section>

      {mode === 'create' ? (
        <ProductEditor
          key={`new-${editorRevision}`}
          item={null}
          stages={initialStages}
          layout={layout}
          exchangeRate={exchangeRate}
          onSaved={reloadItem}
          onDeleted={handleDeleted}
        />
      ) : detailLoading ? (
        <div className="flex min-h-[420px] items-center justify-center rounded-xl border bg-card">
          <div className="text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />상품 정보를 불러오는 중입니다.</div>
        </div>
      ) : item && selectedId ? (
        <ProductEditor
          key={`${item.id}:${item.updatedAt}`}
          item={item}
          stages={initialStages}
          layout={layout}
          exchangeRate={exchangeRate}
          onSaved={reloadItem}
          onDeleted={handleDeleted}
        />
      ) : selectedStageIds.length > 0 ? (
        <ProductSummaryList
          title={selectedStageName}
          summaries={summaries}
          total={total}
          loading={listLoading}
          onSelect={selectProduct}
          onDeleted={handleDeleted}
        />
      ) : null}
    </div>
  )
}

function ProductSummaryList({ title, summaries, total, loading, onSelect, onDeleted }: {
  title: string
  summaries: NewProductSummary[]
  total: number
  loading: boolean
  onSelect: (id: string) => void
  onDeleted: () => void
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const visibleSelectedIds = summaries.filter((summary) => selectedIds.includes(summary.id)).map((summary) => summary.id)
  const allVisibleSelected = summaries.length > 0 && visibleSelectedIds.length === summaries.length

  function toggle(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{title} 상품</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">총 {total.toLocaleString('ko-KR')}건</p>
        </div>
        {summaries.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedIds(allVisibleSelected ? [] : summaries.map((summary) => summary.id))} />
              현재 목록 전체 선택
            </label>
            <BulkDeleteProductsDialog
              itemIds={visibleSelectedIds}
              onDeleted={() => {
                setSelectedIds([])
                onDeleted()
              }}
            />
          </div>
        )}
      </div>
      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />상품 목록을 불러오는 중입니다.</div>
      ) : summaries.length > 0 ? (
        <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
          {summaries.map((summary) => (
            <div key={summary.id} className={cn('relative rounded-lg border bg-background transition hover:border-violet-300 hover:bg-violet-50/50 hover:shadow-sm', selectedIds.includes(summary.id) && 'border-violet-400 ring-1 ring-violet-200')}>
              <label className="absolute left-3 top-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-background/90 shadow-sm" aria-label={`${summary.productName} 선택`}>
                <input type="checkbox" checked={selectedIds.includes(summary.id)} onChange={() => toggle(summary.id)} />
              </label>
              <button type="button" onClick={() => onSelect(summary.id)} className="w-full p-3 pl-12 text-left">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{summary.productName}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">상품번호 {summary.sampleCode || '미입력'}</p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2 py-1 text-[10px] font-medium', toneClasses[summary.stageTone])}>{summary.stageName}</span>
              </div>
                <div className="mt-3 space-y-0.5 text-[11px] text-muted-foreground">
                  <p>최초 등록 {formatDateTime(summary.createdAt)}</p>
                  <p>최근 수정 {formatDateTime(summary.updatedAt)}</p>
                </div>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center text-center">
          <PackageSearch className="mb-2 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">해당 상태의 상품이 없습니다.</p>
          <p className="mt-1 text-xs text-muted-foreground">검색어를 지우거나 다른 상태를 선택해주세요.</p>
        </div>
      )}
      {!loading && total > summaries.length && <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">최근 수정된 {summaries.length}건만 표시 중입니다. 검색어로 오래된 상품을 찾을 수 있습니다.</p>}
    </section>
  )
}

function ToolbarField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('block space-y-1', className)}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function StageMultiSelect({ stages, selectedIds, onChange }: {
  stages: NewProductStage[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const allSelected = stages.length > 0 && selectedIds.length === stages.length
  const summary = selectedIds.length === 0
    ? '상태를 선택하세요'
    : allSelected
      ? '상태: 모두'
      : `상태: ${selectedIds.length}개 선택`

  function toggleStage(stageId: string) {
    onChange(selectedIds.includes(stageId)
      ? selectedIds.filter((id) => id !== stageId)
      : stages.filter((stage) => selectedIds.includes(stage.id) || stage.id === stageId).map((stage) => stage.id))
  }

  return (
    <details className="group relative">
      <summary className="flex h-8 cursor-pointer list-none items-center justify-between rounded-lg border border-input bg-background px-2.5 text-sm marker:content-none">
        <span className="truncate">{summary}</span>
        <span className="ml-2 text-xs text-muted-foreground transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-[min(90vw,360px)] overflow-y-auto rounded-lg border bg-background p-2 shadow-xl">
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm font-semibold hover:bg-muted/60">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onChange(allSelected ? [] : stages.map((stage) => stage.id))}
          />
          <span className="flex-1">전체 단계</span>
          <span className="text-xs text-muted-foreground">{stages.reduce((sum, stage) => sum + stage.itemCount, 0)}</span>
        </label>
        <div className="my-1 border-t" />
        {stages.map((stage, index) => (
          <label key={stage.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/60">
            <input type="checkbox" checked={selectedIds.includes(stage.id)} onChange={() => toggleStage(stage.id)} />
            <span className="min-w-0 flex-1 truncate">{index + 1}. {stage.name}</span>
            <span className="text-xs text-muted-foreground">{stage.itemCount}</span>
          </label>
        ))}
      </div>
    </details>
  )
}
function ProductEditor({ item, stages, layout, exchangeRate, onSaved, onDeleted }: {
  item: NewProductItem | null
  stages: NewProductStage[]
  layout: NewProductEditorLayout
  exchangeRate: CnyKrwReferenceRate
  onSaved: (id: string) => void
  onDeleted: () => void
}) {
  const [values, setValues] = useState(() => item
    ? editorValues(item, exchangeRate.rate)
    : emptyEditorValues(stages[0]?.id ?? '', exchangeRate.rate))
  const [pendingAttachments, setPendingAttachments] = useState<Partial<Record<NewProductAttachment['kind'], File[]>>>({})
  const [pending, startTransition] = useTransition()

  function setValue<K extends keyof EditorValues>(key: K, value: EditorValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function setCost(value: string) {
    const calculation = calculateSalesPrices({ costKrw: normalizedNumber(value) ?? 0 })
    setValues((current) => ({
      ...current,
      estimatedCost: value,
      b2bPrice: calculation ? String(calculation.b2bPrice) : '',
      b2cPrice: calculation ? String(calculation.b2cPrice) : '',
    }))
  }

  function applyAutomaticPrice() {
    const calculation = calculateSalesPrices({
      costKrw: normalizedNumber(values.estimatedCost) ?? normalizedNumber(values.calculatedCostKrw) ?? 0,
    })
    if (!calculation) {
      toast.error('원가를 먼저 입력해주세요.')
      return
    }
    setValues((current) => ({ ...current, b2bPrice: String(calculation.b2bPrice), b2cPrice: String(calculation.b2cPrice) }))
    toast.success('펀타스틱 계산식으로 판매가를 계산했습니다.')
  }

  function save() {
    startTransition(async () => {
      if (item) {
        const result = await updateNewProductAction({ itemId: item.id, values })
        if (!result.success) {
          toast.error(result.error)
          return
        }
        showItemMasterSaveToast(result.itemMasterSync.status, false)
        onSaved(item.id)
        return
      }

      const result = await createNewProductAction({ values })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      const pendingFiles = Object.entries(pendingAttachments).flatMap(([kind, files]) => (
        (files ?? []).map((file) => ({ kind: kind as NewProductAttachment['kind'], file }))
      ))
      if (pendingFiles.length > 0) {
        const uploadResults = await Promise.allSettled(
          pendingFiles.map(({ kind, file }) => uploadAttachmentFile(result.id, kind, file)),
        )
        const failedUploads = uploadResults.filter((uploadResult) => uploadResult.status === 'rejected').length
        if (failedUploads > 0) toast.warning(`상품은 저장했지만 첨부파일 ${failedUploads}개를 업로드하지 못했습니다.`)
      }
      showItemMasterSaveToast(result.itemMasterSync.status, true)
      onSaved(result.id)
    })
  }

  const calculation = calculateSalesPrices({
    costKrw: normalizedNumber(values.estimatedCost) ?? normalizedNumber(values.calculatedCostKrw) ?? 0,
    b2bPriceOverride: normalizedNumber(values.b2bPrice),
    b2cPriceOverride: normalizedNumber(values.b2cPrice),
  })
  const visibleSections = layout.sectionOrder.filter((section) => !layout.hiddenSections.includes(section))
  const fieldGridClass = layout.columns === 1
    ? 'grid-cols-1'
    : layout.columns === 3
      ? 'md:grid-cols-2 2xl:grid-cols-3'
      : 'md:grid-cols-2'

  const sectionContent: Record<NewProductEditorSection, React.ReactNode> = {
    progress: (
      <EditorSection title="진행 상태" icon={Sparkles}>
        <div className={cn('grid gap-3', fieldGridClass)}>
          <Field label="현재 단계"><StageSelect value={values.stageId} onChange={(value) => setValue('stageId', value)} stages={stages} /></Field>
          <Field label="상품번호"><Input value={values.sampleCode} onChange={(event) => setValue('sampleCode', event.target.value)} placeholder="상품번호를 입력하세요" /></Field>
        </div>
        {item?.stageHistory && item.stageHistory.length > 0 && (
          <div className="mt-4 rounded-lg bg-muted/40 p-3">
            <p className="mb-2 text-xs font-semibold">최근 단계 변경</p>
            <div className="grid gap-2 lg:grid-cols-2">
              {item.stageHistory.slice(0, 6).map((history) => (
                <div key={history.id} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0"><span className="text-muted-foreground">{history.fromStageName ? `${history.fromStageName} → ` : ''}</span><strong>{history.toStageName}</strong>{history.note && <span className="ml-1 text-muted-foreground">· {history.note}</span>}</span>
                  <time className="shrink-0 text-muted-foreground">{shortDate(history.changedAt)}</time>
                </div>
              ))}
            </div>
          </div>
        )}
      </EditorSection>
    ),
    basic: (
      <EditorSection title="기본 상품 정보" icon={PencilLine}>
        <div className={cn('grid gap-3', fieldGridClass)}>
          <Field label="상품명" required><Input value={values.productName} onChange={(event) => setValue('productName', event.target.value)} placeholder="상품명을 입력하세요" /></Field>
          <Field label="등록 상품명"><Input value={values.registeredProductName} onChange={(event) => setValue('registeredProductName', event.target.value)} /></Field>
          <Field label="제품 영문명"><Input value={values.englishName} onChange={(event) => setValue('englishName', event.target.value)} /></Field>
          <Field label="중국사용 항목"><Input value={values.chinaItemName} onChange={(event) => setValue('chinaItemName', event.target.value)} /></Field>
          <Field label="중국 구매 링크"><UrlInput value={values.sourceUrl} onChange={(value) => setValue('sourceUrl', value)} /></Field>
          <Field label="패키지 정보 URL"><UrlInput value={values.packageInfoUrl} onChange={(value) => setValue('packageInfoUrl', value)} /></Field>
          <Field label="판매예정일"><Input type="date" value={values.plannedSaleDate} onChange={(event) => setValue('plannedSaleDate', event.target.value)} /></Field>
          <Field label="상세페이지 완료예정일"><Input type="date" value={values.detailPageDueDate} onChange={(event) => setValue('detailPageDueDate', event.target.value)} /></Field>
          <Field label="필수 체크 사항"><TextArea value={values.requiredChecks} onChange={(value) => setValue('requiredChecks', value)} placeholder="미팅 전 반드시 확인할 내용" /></Field>
          <Field label="비고"><TextArea value={values.referenceNotes} onChange={(value) => setValue('referenceNotes', value)} /></Field>
          <Field label="히스토리 메모"><TextArea value={values.historyNotes} onChange={(value) => setValue('historyNotes', value)} placeholder="날짜 / 담당자 / 결정 내용" rows={4} /></Field>
        </div>
      </EditorSection>
    ),
    itemMaster: (
      <EditorSection title="품목 등록 정보" icon={PackageSearch}>
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
          5단계 이상으로 저장하면 사방넷코드를 품목코드로 사용해 품목에 자동으로 추가하거나 갱신합니다.
        </div>
        <div className={cn('grid gap-3', fieldGridClass)}>
          <Field label="사방넷코드"><Input value={values.sabangnetCode} onChange={(event) => setValue('sabangnetCode', event.target.value)} placeholder="품목에 등록할 품목코드" /></Field>
          <Field label="구매참고사항"><TextArea value={values.purchaseReferenceNotes} onChange={(value) => setValue('purchaseReferenceNotes', value)} placeholder="MOQ, 구매 옵션, 공급처 전달사항" /></Field>
          <Field label="중국원가 (위안화)"><MoneyInput value={values.chinaUnitPriceCny} onChange={(value) => setValue('chinaUnitPriceCny', value)} /></Field>
          <Field label="원화원가 (₩)"><MoneyInput value={values.calculatedCostKrw} onChange={(value) => setValue('calculatedCostKrw', value)} /></Field>
          <Field label="이전원가 (₩)"><MoneyInput value={values.previousCostKrw} onChange={(value) => setValue('previousCostKrw', value)} /></Field>
          <Field label="B2B 옵션추가금"><MoneyInput value={values.b2bOptionSurcharge} onChange={(value) => setValue('b2bOptionSurcharge', value)} /></Field>
          <Field label="B2C 옵션추가금"><MoneyInput value={values.b2cOptionSurcharge} onChange={(value) => setValue('b2cOptionSurcharge', value)} /></Field>
        </div>
      </EditorSection>
    ),
    attachments: (
      <EditorSection title="이미지 및 품질표시 파일" icon={ImageIcon}>
        {!item && <p className="mb-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">여기서 고른 파일은 신상품 저장 버튼을 누르면 상품 정보와 함께 업로드됩니다.</p>}
        <div className={cn('grid gap-3', fieldGridClass)}>
          {attachmentKinds.map(({ kind, label }) => (
            <AttachmentPanel
              key={kind}
              itemId={item?.id ?? null}
              kind={kind}
              label={label}
              attachments={item?.attachments ?? []}
              pendingFiles={pendingAttachments[kind] ?? []}
              onPendingFilesChange={(files) => setPendingAttachments((current) => ({ ...current, [kind]: files }))}
              onChanged={() => item && onSaved(item.id)}
            />
          ))}
        </div>
      </EditorSection>
    ),
    notice: (
      <EditorSection title="상품정보고시" icon={FileText}>
        <p className="mb-3 text-xs text-muted-foreground">5단계 이상 저장 시 아래 정보가 품목의 상품정보고시 입력칸에도 함께 반영됩니다.</p>
        <div className={cn('grid gap-3', fieldGridClass)}>
          <Field label="재질 (C)"><Input value={values.noticeMaterial} onChange={(event) => setValue('noticeMaterial', event.target.value)} /></Field>
          <Field label="제품 크기 (C)"><Input value={values.noticeSize} onChange={(event) => setValue('noticeSize', event.target.value)} placeholder="예: 5.5 × 5.5cm" /></Field>
          <Field label="제조사 (C)"><Input value={values.noticeManufacturer} onChange={(event) => setValue('noticeManufacturer', event.target.value)} /></Field>
          <Field label="무게 (C)"><Input value={values.noticeWeight} onChange={(event) => setValue('noticeWeight', event.target.value)} placeholder="예: 20g" /></Field>
          <Field label="제조국"><Input value={values.noticeCountry} onChange={(event) => setValue('noticeCountry', event.target.value)} /></Field>
          <Field label="용량 (C)"><Input value={values.noticeCapacity} onChange={(event) => setValue('noticeCapacity', event.target.value)} /></Field>
          <Field label="[식약처] 유리/도자기제품 필수확인 (C)"><TextArea value={values.noticeFoodSafety} onChange={(value) => setValue('noticeFoodSafety', value)} /></Field>
          <Field label="구성품"><TextArea value={values.noticeComponents} onChange={(value) => setValue('noticeComponents', value)} /></Field>
          <Field label="특이사항"><TextArea value={values.noticeSpecialNotes} onChange={(value) => setValue('noticeSpecialNotes', value)} /></Field>
        </div>
      </EditorSection>
    ),
    package: (
      <EditorSection title="패키지·등록 준비" icon={PackageSearch}>
        <div className={cn('grid gap-3', fieldGridClass)}>
          <Field label="패키지 진행완료 여부"><StatusInput value={values.packageProgressStatus} onChange={(value) => setValue('packageProgressStatus', value)} /></Field>
          <Field label="패키지 상태"><Input value={values.packageStatus} onChange={(event) => setValue('packageStatus', event.target.value)} /></Field>
          <Field label="한글 설명서 유무"><StatusInput value={values.koreanManualStatus} onChange={(value) => setValue('koreanManualStatus', value)} /></Field>
          <Field label="품질표시 작업"><Input value={values.qualityNoticeStatus} onChange={(event) => setValue('qualityNoticeStatus', event.target.value)} /></Field>
          <Field label="패키지박스 디자인"><StatusInput value={values.packageBoxDesign} onChange={(value) => setValue('packageBoxDesign', value)} /></Field>
          <Field label="패키지 제조"><StatusInput value={values.packageManufacturer} onChange={(value) => setValue('packageManufacturer', value)} /></Field>
          <Field label="패키지 포장"><StatusInput value={values.packagePacking} onChange={(value) => setValue('packagePacking', value)} /></Field>
          <Field label="택배사"><Input value={values.carrier} onChange={(event) => setValue('carrier', event.target.value)} /></Field>
        </div>
      </EditorSection>
    ),
    pricing: (
      <EditorSection title="원가 및 판매가 계산" icon={PencilLine}>
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-semibold text-violet-900">펀타스틱 판매가 계산식</p>
              <p className="text-xs text-violet-700">원가를 기준으로 도매·소매 판매가와 예상 마진을 계산합니다.</p>
            </div>
            <Button type="button" size="sm" onClick={applyAutomaticPrice}>자동 계산</Button>
          </div>
        </div>
        <div className={cn('mt-3 grid gap-3', fieldGridClass)}>
          <Field label="원가 (₩)"><MoneyInput value={values.estimatedCost} onChange={setCost} /></Field>
          <Field label="B2B 판매가·도매 (₩)"><MoneyInput value={values.b2bPrice} onChange={(value) => setValue('b2bPrice', value)} /></Field>
          <Field label="B2C 판매가·소매 (₩)"><MoneyInput value={values.b2cPrice} onChange={(value) => setValue('b2cPrice', value)} /></Field>
          <Field label="신고금액"><MoneyInput value={values.declaredValue} onChange={(value) => setValue('declaredValue', value)} /></Field>
          <Field label="B2B 택배비"><MoneyInput value={values.b2bShippingFee} onChange={(value) => setValue('b2bShippingFee', value)} /></Field>
          <Field label="B2C 택배비"><MoneyInput value={values.b2cShippingFee} onChange={(value) => setValue('b2cShippingFee', value)} /></Field>
        </div>
        {calculation && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ProfitCard label="B2B 예상" price={calculation.b2bPrice} profit={calculation.b2bProfit} margin={calculation.b2bMargin} fee="수수료 10%" />
            <ProfitCard label="B2C 예상" price={calculation.b2cPrice} profit={calculation.b2cProfit} margin={calculation.b2cMargin} fee="수수료 25%" />
          </div>
        )}
      </EditorSection>
    ),
  }

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">{item ? item.productName : '신상품 정보 등록'}</h2>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            {item ? `최근 수정 ${formatDateTime(item.updatedAt)}` : '필요한 정보를 한 화면에서 입력한 뒤 저장하세요.'}
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
          {item && <DeleteProductDialog item={item} onDeleted={onDeleted} />}
          <Button onClick={save} disabled={pending || !values.productName.trim()} size="lg" className="w-full shrink-0 sm:w-auto"><Save />{pending ? '저장 중...' : item ? '변경사항 저장' : '신상품 저장'}</Button>
        </div>
      </div>

      {visibleSections.length > 1 && (
        <nav aria-label="상품 정보 항목 바로가기" className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">항목 바로가기</p>
          <div className="flex flex-wrap gap-2">
            {visibleSections.map((section) => (
              <Button
                key={section}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => document.getElementById(`new-product-section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {sectionLabels[section]}
              </Button>
            ))}
          </div>
        </nav>
      )}

      {visibleSections.length > 0
        ? visibleSections.map((section) => <div key={section} id={`new-product-section-${section}`} className="scroll-mt-4">{sectionContent[section]}</div>)
        : <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">표시하도록 설정된 등록 영역이 없습니다. 상단의 레이아웃 설정에서 영역을 켜주세요.</div>}

      <div className="flex justify-end rounded-xl border bg-card p-4 shadow-sm">
        <Button onClick={save} disabled={pending || !values.productName.trim()} size="lg" className="w-full sm:w-auto"><Save />{pending ? '저장 중...' : item ? '변경사항 저장' : '신상품 저장'}</Button>
      </div>
    </div>
  )
}

function BulkDeleteProductsDialog({ itemIds, onDeleted }: { itemIds: string[]; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      const result = await deleteNewProductsAction({ itemIds })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`신상품 ${result.deleted.toLocaleString('ko-KR')}개를 삭제했습니다.`)
      setOpen(false)
      onDeleted()
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={(props) => <Button {...props} type="button" size="sm" variant="destructive" disabled={itemIds.length === 0}><Trash2 />선택 삭제 ({itemIds.length})</Button>} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background shadow-2xl">
          <div className="p-5">
            <Dialog.Title className="text-lg font-semibold">선택한 상품을 모두 삭제할까요?</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              선택한 <strong className="text-foreground">{itemIds.length.toLocaleString('ko-KR')}개 상품</strong>과 각 상품의 첨부파일, 단계 변경 이력이 함께 삭제됩니다. 삭제 후에는 복구할 수 없습니다.
            </Dialog.Description>
          </div>
          <div className="flex justify-end gap-2 border-t p-4">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline" disabled={pending}>취소</Button>} />
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}정말 {itemIds.length.toLocaleString('ko-KR')}개 삭제
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DeleteProductDialog({ item, onDeleted }: { item: NewProductItem; onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      const result = await deleteNewProductAction({ itemId: item.id })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('신상품을 삭제했습니다.')
      setOpen(false)
      onDeleted()
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={(props) => <Button {...props} type="button" size="lg" variant="destructive"><Trash2 />상품 삭제</Button>} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background shadow-2xl">
          <div className="p-5">
            <Dialog.Title className="text-lg font-semibold">이 상품을 정말 삭제할까요?</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              <strong className="text-foreground">{item.productName}</strong> 상품과 첨부파일, 단계 변경 이력이 함께 삭제됩니다. 삭제 후에는 복구할 수 없습니다.
            </Dialog.Description>
          </div>
          <div className="flex justify-end gap-2 border-t p-4">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline" disabled={pending}>취소</Button>} />
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}정말 삭제
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function EditorSection({ title, icon: Icon, children }: { title: string; icon: typeof Sparkles; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 border-b pb-3 text-base font-semibold"><Icon className="h-4 w-4 text-violet-600" />{title}</h3>
      {children}
    </section>
  )
}

function StageSettingsDialog({ stages, onSaved }: { stages: NewProductStage[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Array<{ id?: string; name: string; tone: NewProductStageTone }>>(
    () => stages.map(({ id, name, tone }) => ({ id, name, tone })),
  )

  function setDialogOpen(next: boolean) {
    setOpen(next)
    if (next) setDrafts(stages.map(({ id, name, tone }) => ({ id, name, tone })))
  }

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= drafts.length) return
    setDrafts((current) => {
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  function save() {
    startTransition(async () => {
      const result = await saveNewProductStagesAction({ stages: drafts })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('진행 단계 설정을 저장했습니다.')
      setOpen(false)
      onSaved()
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setDialogOpen}>
      <Dialog.Trigger render={(props) => <Button {...props} variant="outline"><Settings2 />단계 설정</Button>} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(94vw,680px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-background shadow-2xl">
          <div className="border-b p-5">
            <Dialog.Title className="text-lg font-semibold">진행 단계 설정</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">단계 이름·색상·순서를 수정하거나 새 단계를 추가합니다.</Dialog.Description>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {drafts.map((stage, index) => (
              <div key={stage.id ?? `new-${index}`} className="flex items-center gap-2 rounded-lg border bg-muted/20 p-2">
                <span className="w-6 text-center text-xs font-semibold text-muted-foreground">{index + 1}</span>
                <Input value={stage.name} onChange={(event) => setDrafts((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, name: event.target.value } : entry))} className="flex-1" />
                <select value={stage.tone} onChange={(event) => setDrafts((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, tone: event.target.value as NewProductStageTone } : entry))} className={cn('h-8 rounded-lg border-0 px-2 text-xs', toneClasses[stage.tone])}>
                  {Object.keys(toneClasses).map((tone) => <option key={tone} value={tone}>{tone}</option>)}
                </select>
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} aria-label="위로 이동" onClick={() => move(index, -1)}><ArrowUp /></Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === drafts.length - 1} aria-label="아래로 이동" onClick={() => move(index, 1)}><ArrowDown /></Button>
                {!stage.id && <Button type="button" variant="ghost" size="icon-sm" aria-label="새 단계 삭제" onClick={() => setDrafts((current) => current.filter((_, entryIndex) => entryIndex !== index))}><Trash2 /></Button>}
              </div>
            ))}
            <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setDrafts((current) => [...current, { name: '새 단계', tone: 'slate' }])}><Plus />단계 추가</Button>
          </div>
          <div className="flex justify-end gap-2 border-t p-4">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline">취소</Button>} />
            <Button onClick={save} disabled={pending}>{pending && <Loader2 className="animate-spin" />}설정 저장</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function LayoutSettingsDialog({ layout, onSaved }: { layout: NewProductEditorLayout; onSaved: (layout: NewProductEditorLayout) => void }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState(layout)

  function setDialogOpen(next: boolean) {
    setOpen(next)
    if (next) setDraft({ ...layout, sectionOrder: [...layout.sectionOrder], hiddenSections: [...layout.hiddenSections] })
  }

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= draft.sectionOrder.length) return
    setDraft((current) => {
      const sectionOrder = [...current.sectionOrder]
      ;[sectionOrder[index], sectionOrder[nextIndex]] = [sectionOrder[nextIndex], sectionOrder[index]]
      return { ...current, sectionOrder }
    })
  }

  function toggle(section: NewProductEditorSection) {
    setDraft((current) => ({
      ...current,
      hiddenSections: current.hiddenSections.includes(section)
        ? current.hiddenSections.filter((entry) => entry !== section)
        : [...current.hiddenSections, section],
    }))
  }

  function save() {
    startTransition(async () => {
      const result = await saveNewProductEditorLayoutAction({ layout: draft })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('등록 화면 레이아웃을 저장했습니다.')
      setOpen(false)
      onSaved(result.layout)
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setDialogOpen}>
      <Dialog.Trigger render={(props) => <Button {...props} variant="outline"><LayoutTemplate />레이아웃 설정</Button>} />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background shadow-2xl">
          <div className="border-b p-5">
            <Dialog.Title className="text-lg font-semibold">상품 등록 레이아웃 설정</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">입력 영역의 순서·표시 여부·한 줄 열 수를 원하는 방식으로 저장합니다.</Dialog.Description>
          </div>
          <div className="space-y-5 p-5">
            <Field label="한 줄 입력 열 수">
              <select value={draft.columns} onChange={(event) => setDraft((current) => ({ ...current, columns: Number(event.target.value) as 1 | 2 | 3 }))} className="h-8 w-full rounded-lg border bg-background px-2 text-sm">
                <option value={1}>1열 · 넓게 입력</option>
                <option value={2}>2열 · 기본</option>
                <option value={3}>3열 · 많은 항목 보기</option>
              </select>
            </Field>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">영역 순서와 표시 여부</p>
              <div className="space-y-2">
                {draft.sectionOrder.map((section, index) => {
                  const visible = !draft.hiddenSections.includes(section)
                  const required = section === 'basic'
                  return (
                    <div key={section} className="flex items-center gap-2 rounded-lg border p-2">
                      <input type="checkbox" checked={visible} disabled={required} onChange={() => toggle(section)} aria-label={`${sectionLabels[section]} 표시`} />
                      <span className={cn('flex-1 text-sm font-medium', !visible && 'text-muted-foreground line-through')}>{sectionLabels[section]}{required && <span className="ml-1 text-[10px] text-violet-600">필수</span>}</span>
                      <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} aria-label="위로 이동" onClick={() => move(index, -1)}><ArrowUp /></Button>
                      <Button type="button" variant="ghost" size="icon-sm" disabled={index === draft.sectionOrder.length - 1} aria-label="아래로 이동" onClick={() => move(index, 1)}><ArrowDown /></Button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t p-4">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline">취소</Button>} />
            <Button onClick={save} disabled={pending}>{pending && <Loader2 className="animate-spin" />}레이아웃 저장</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}{required && <span className="ml-1 text-red-500">*</span>}</span>
      {children}
    </label>
  )
}

function StageSelect({ value, onChange, stages }: { value: string; onChange: (value: string) => void; stages: NewProductStage[] }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30">
      {stages.map((stage, index) => <option key={stage.id} value={stage.id}>{index + 1}. {stage.name}</option>)}
    </select>
  )
}

function StatusInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm">
      <option value="">선택 안 함</option>
      <option value="대기">대기</option>
      <option value="진행중">진행중</option>
      <option value="완료">완료</option>
      <option value="해당없음">해당없음</option>
    </select>
  )
}

function UrlInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex gap-1">
      <Input type="url" value={value} onChange={(event) => onChange(event.target.value)} placeholder="https://" />
      {/^https?:\/\//.test(value) && <a href={value} target="_blank" rel="noreferrer"><Button type="button" size="icon" variant="outline" aria-label="링크 열기"><ExternalLink /></Button></a>}
    </div>
  )
}

function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (value: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={rows} className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30" />
}

function MoneyInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Input inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" />
}

function ProfitCard({ label, price, profit, margin, fee }: { label: string; price: number; profit: number; margin: number; fee: string }) {
  return (
    <div className="rounded-lg border bg-muted/25 p-3">
      <div className="flex items-center justify-between"><strong className="text-xs">{label}</strong><span className="text-[10px] text-muted-foreground">{fee}</span></div>
      <p className="mt-2 text-lg font-bold">{won(price)}</p>
      <p className={cn('text-xs', profit >= 0 ? 'text-emerald-700' : 'text-red-600')}>예상 이익 {won(profit)} · 마진 {(margin * 100).toFixed(1)}%</p>
    </div>
  )
}

function AttachmentPanel({ itemId, kind, label, attachments, pendingFiles, onPendingFilesChange, onChanged }: {
  itemId: string | null
  kind: NewProductAttachment['kind']
  label: string
  attachments: NewProductAttachment[]
  pendingFiles: File[]
  onPendingFilesChange: (files: File[]) => void
  onChanged: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const files = attachments.filter((attachment) => attachment.kind === kind)
  const isPdf = kind === 'quality_pdf'

  async function upload(file?: File) {
    if (!file) return
    const validationError = attachmentValidationError(file, isPdf)
    if (validationError) {
      toast.error(validationError)
      return
    }
    if (!itemId) {
      onPendingFilesChange([...pendingFiles, file])
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setUploading(true)
    try {
      await uploadAttachmentFile(itemId, kind, file)
      toast.success(`${file.name} 업로드 완료`)
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '업로드에 실패했습니다.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(attachment: NewProductAttachment) {
    if (!window.confirm(`“${attachment.fileName}” 파일을 정말 삭제할까요?`)) return
    const response = await fetch(`/api/new-products/attachments/${attachment.id}`, { method: 'DELETE' })
    const result = await response.json() as { success?: boolean; error?: string }
    if (!response.ok) {
      toast.error(result.error || '파일 삭제에 실패했습니다.')
      return
    }
    toast.success('파일을 삭제했습니다.')
    onChanged()
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-semibold">{label}</p>
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]) }}
        className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed py-4 text-xs text-muted-foreground transition hover:border-violet-400 hover:bg-violet-50/50 disabled:cursor-not-allowed"
      >
        {uploading ? <Loader2 className="mb-1 h-5 w-5 animate-spin" /> : <UploadCloud className="mb-1 h-5 w-5" />}
        {uploading ? '업로드 중...' : `${isPdf ? 'PDF' : '이미지'}를 끌어놓거나 클릭`}
      </button>
      <input ref={inputRef} type="file" accept={isPdf ? 'application/pdf' : 'image/jpeg,image/png,image/webp,image/gif'} className="hidden" onChange={(event) => void upload(event.target.files?.[0])} />
      {files.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
          {files.map((attachment) => (
            <div key={attachment.id} className="group relative overflow-hidden rounded-md border bg-muted/20">
              <a href={`/api/new-products/attachments/${attachment.id}`} target="_blank" rel="noreferrer" className="block">
                {isPdf ? (
                  <div className="flex h-20 flex-col items-center justify-center px-2"><FileText className="h-6 w-6 text-red-500" /><span className="mt-1 line-clamp-1 max-w-full text-[10px]">{attachment.fileName}</span></div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/new-products/attachments/${attachment.id}`} alt={attachment.fileName} className="h-24 w-full object-cover" />
                )}
              </a>
              <button type="button" aria-label="첨부 삭제" onClick={() => void remove(attachment)} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div className="mt-2 space-y-1">
          {pendingFiles.map((file, index) => (
            <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-md bg-violet-50 px-2 py-1.5 text-xs text-violet-800">
              {isPdf ? <FileText className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button type="button" aria-label="대기 파일 제거" onClick={() => onPendingFilesChange(pendingFiles.filter((_, fileIndex) => fileIndex !== index))}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">파일당 최대 4MB</p>
    </div>
  )
}

const attachmentKinds: Array<{ kind: NewProductAttachment['kind']; label: string }> = [
  { kind: 'product_image', label: '제품 이미지' },
  { kind: 'sample_china_image', label: '샘플 입고 구성품·검수 이미지 (중국)' },
  { kind: 'final_sample_image', label: '샘플 확정 이미지·구성품 (한국)' },
  { kind: 'quality_pdf', label: '품질표시 등록 PDF' },
]

function showItemMasterSaveToast(
  status: 'not_required' | 'pending_code' | 'created' | 'updated',
  created: boolean,
) {
  if (status === 'pending_code') {
    toast.warning('신상품은 저장했습니다. 5단계 이상은 사방넷코드를 입력하면 품목에 자동 반영됩니다.')
    return
  }
  if (status === 'created') {
    toast.success('신상품 정보를 저장하고 품목에 새로 추가했습니다.')
    return
  }
  if (status === 'updated') {
    toast.success('신상품 정보와 기존 품목 정보를 함께 갱신했습니다.')
    return
  }
  toast.success(created ? '신상품을 등록했습니다.' : '신상품 정보를 저장했습니다.')
}

async function uploadAttachmentFile(itemId: string, kind: NewProductAttachment['kind'], file: File) {
  const formData = new FormData()
  formData.set('itemId', itemId)
  formData.set('kind', kind)
  formData.set('file', file)
  const response = await fetch('/api/new-products/attachments', { method: 'POST', body: formData })
  const result = await response.json() as { success?: boolean; error?: string }
  if (!response.ok) throw new Error(result.error || '업로드에 실패했습니다.')
}

function attachmentValidationError(file: File, isPdf: boolean) {
  if (file.size <= 0 || file.size > 4 * 1024 * 1024) return '파일은 4MB 이하만 업로드할 수 있습니다.'
  if (isPdf && file.type !== 'application/pdf') return '품질표시 파일은 PDF만 가능합니다.'
  if (!isPdf && !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    return '이미지는 JPG, PNG, WEBP, GIF만 가능합니다.'
  }
  return null
}

type EditorValues = ReturnType<typeof emptyEditorValues>

function emptyEditorValues(stageId: string, exchangeRateKrw: number) {
  return {
    stageId,
    sampleCode: '',
    productName: '',
    productOption: '',
    chinaUnitPriceCny: '',
    unitShippingCny: '',
    exchangeRateKrw: String(exchangeRateKrw),
    calculatedCostKrw: '',
    domesticSaleUrl: '',
    domesticSalePrice: '',
    detailPageUrl: '',
    memo1: '',
    memo2: '',
    englishName: '',
    sourceUrl: '',
    requiredChecks: '',
    estimatedCost: '',
    historyNotes: '',
    referenceNotes: '',
    chinaItemName: '',
    plannedSaleDate: '',
    detailPageDueDate: '',
    registeredProductName: '',
    packageInfoUrl: '',
    packageProgressStatus: '',
    packageStatus: '',
    koreanManualStatus: '',
    declaredValue: '',
    b2bPrice: '',
    b2cPrice: '',
    carrier: '',
    b2bShippingFee: '',
    b2cShippingFee: '',
    qualityNoticeStatus: '',
    packageBoxDesign: '',
    packageManufacturer: '',
    packagePacking: '',
    sabangnetCode: '',
    purchaseReferenceNotes: '',
    previousCostKrw: '',
    b2bOptionSurcharge: '',
    b2cOptionSurcharge: '',
    noticeMaterial: '',
    noticeSize: '',
    noticeManufacturer: '',
    noticeWeight: '',
    noticeCountry: '',
    noticeCapacity: '',
    noticeFoodSafety: '',
    noticeComponents: '',
    noticeSpecialNotes: '',
  }
}

function editorValues(item: NewProductItem, defaultExchangeRate: number): EditorValues {
  return {
    stageId: item.stageId,
    sampleCode: item.sampleCode ?? '',
    productName: item.productName,
    productOption: item.productOption ?? '',
    chinaUnitPriceCny: valueString(item.chinaUnitPriceCny),
    unitShippingCny: valueString(item.unitShippingCny),
    exchangeRateKrw: valueString(item.exchangeRateKrw ?? defaultExchangeRate),
    calculatedCostKrw: valueString(item.calculatedCostKrw),
    domesticSaleUrl: item.domesticSaleUrl ?? '',
    domesticSalePrice: valueString(item.domesticSalePrice),
    detailPageUrl: item.detailPageUrl ?? '',
    memo1: item.memo1 ?? '',
    memo2: item.memo2 ?? '',
    englishName: item.englishName ?? '',
    sourceUrl: item.sourceUrl ?? '',
    requiredChecks: item.requiredChecks ?? '',
    estimatedCost: valueString(item.estimatedCost),
    historyNotes: item.historyNotes ?? '',
    referenceNotes: item.referenceNotes ?? '',
    chinaItemName: item.chinaItemName ?? '',
    plannedSaleDate: item.plannedSaleDate ?? '',
    detailPageDueDate: item.detailPageDueDate ?? '',
    registeredProductName: item.registeredProductName ?? '',
    packageInfoUrl: item.packageInfoUrl ?? '',
    packageProgressStatus: item.packageProgressStatus ?? '',
    packageStatus: item.packageStatus ?? '',
    koreanManualStatus: item.koreanManualStatus ?? '',
    declaredValue: valueString(item.declaredValue),
    b2bPrice: valueString(item.b2bPrice),
    b2cPrice: valueString(item.b2cPrice),
    carrier: item.carrier ?? '',
    b2bShippingFee: valueString(item.b2bShippingFee),
    b2cShippingFee: valueString(item.b2cShippingFee),
    qualityNoticeStatus: item.qualityNoticeStatus ?? '',
    packageBoxDesign: item.packageBoxDesign ?? '',
    packageManufacturer: item.packageManufacturer ?? '',
    packagePacking: item.packagePacking ?? '',
    sabangnetCode: item.sabangnetCode ?? '',
    purchaseReferenceNotes: item.purchaseReferenceNotes ?? '',
    previousCostKrw: valueString(item.previousCostKrw),
    b2bOptionSurcharge: valueString(item.b2bOptionSurcharge),
    b2cOptionSurcharge: valueString(item.b2cOptionSurcharge),
    noticeMaterial: item.noticeMaterial ?? '',
    noticeSize: item.noticeSize ?? '',
    noticeManufacturer: item.noticeManufacturer ?? '',
    noticeWeight: item.noticeWeight ?? '',
    noticeCountry: item.noticeCountry ?? '',
    noticeCapacity: item.noticeCapacity ?? '',
    noticeFoodSafety: item.noticeFoodSafety ?? '',
    noticeComponents: item.noticeComponents ?? '',
    noticeSpecialNotes: item.noticeSpecialNotes ?? '',
  }
}

function normalizedNumber(value: string) {
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function valueString(value: number | null) {
  return value == null ? '' : String(value)
}

function won(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function shortDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}
