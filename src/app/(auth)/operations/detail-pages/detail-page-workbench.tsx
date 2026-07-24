'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Check, CircleAlert, Clock3, ExternalLink, FilePenLine, ImagePlus, Link2, LoaderCircle, PanelsTopLeft, Plus, Trash2, WandSparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export type DetailPageProduct = {
  id: string
  sku: string
  name: string
  option: string
  purchaseUrl: string
  material: string
  size: string
  manufacturer: string
  weight: string
  country: string
  capacity: string
}

type DetailPageJob = {
  id: string
  product: DetailPageProduct
  status: 'draft' | 'asset_pending' | 'collecting' | 'review' | 'completed'
  template: string
  note: string
  createdAt: string
  images: string[]
  imageRunId: string | null
  imageAcknowledged: boolean
  imageError: string | null
}

const STATUS = {
  draft: { label: '작업 설정', className: 'border-slate-200 bg-slate-50 text-slate-700' },
  asset_pending: { label: '이미지 수집 대기', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  collecting: { label: '이미지 수집 중', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  review: { label: '검수 필요', className: 'border-violet-200 bg-violet-50 text-violet-800' },
  completed: { label: '제작 완료', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
} as const

const EMPTY_PRODUCT: DetailPageProduct = {
  id: '', sku: '', name: '', option: '', purchaseUrl: '', material: '', size: '', manufacturer: '', weight: '', country: '', capacity: '',
}

const DETAIL_PAGE_SELECTION_KEY = 'funtastic-detail-page-selection'
const EMPTY_PRODUCTS: DetailPageProduct[] = []
const PAGE_SOURCE = 'funtastic-saas'
const EXTENSION_SOURCE = 'funtastic-1688-extension'
let cachedSessionProducts: DetailPageProduct[] | null = null

export function DetailPageWorkbench({ selectedProducts }: { selectedProducts: DetailPageProduct[] }) {
  const sessionProducts = useSyncExternalStore(
    subscribeToSessionProducts,
    readSessionProducts,
    () => EMPTY_PRODUCTS,
  )
  const [jobs, setJobs] = useState<DetailPageJob[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [template, setTemplate] = useState('기본 상품 상세')
  const [note, setNote] = useState('')
  const [consumedProductIds, setConsumedProductIds] = useState<Set<string>>(() => new Set())
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(() => new Set())
  const [extensionReady, setExtensionReady] = useState(false)
  const incomingProducts = selectedProducts.length > 0 ? selectedProducts : sessionProducts
  const draftProducts = useMemo(
    () => incomingProducts.filter((product) => !consumedProductIds.has(product.id)),
    [consumedProductIds, incomingProducts],
  )
  const selectedDraftProducts = useMemo(
    () => draftProducts.filter((product) => selectedDraftIds.has(product.id)),
    [draftProducts, selectedDraftIds],
  )
  const hasDraftProducts = draftProducts.length > 0
  const allDraftsSelected = hasDraftProducts && selectedDraftProducts.length === draftProducts.length
  const activeJob = jobs.find((job) => job.id === activeId) ?? null
  const activeProduct = activeJob?.product ?? selectedDraftProducts[0] ?? draftProducts[0] ?? EMPTY_PRODUCT
  const missingFields = useMemo(() => (
    [
      ['구매 URL', activeProduct.purchaseUrl],
      ['재질', activeProduct.material],
      ['제품크기', activeProduct.size],
      ['제조국', activeProduct.country],
    ].filter(([, value]) => !value.trim()).map(([label]) => label)
  ), [activeProduct])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return
      const message = event.data
      if (!message || message.source !== EXTENSION_SOURCE || typeof message.type !== 'string') return

      if (message.type === 'FUNTASTIC_1688_PONG') {
        setExtensionReady(true)
        return
      }

      if (message.type === 'FUNTASTIC_1688_DETAIL_IMAGES_RESULT') {
        const images = normalizeImageUrls(message.images)
        setJobs((current) => current.map((job) => {
          if (job.id !== message.jobId || job.imageRunId !== message.runId) return job
          return images.length > 0
            ? { ...job, status: 'review', images, imageRunId: null, imageError: null }
            : { ...job, status: 'asset_pending', imageRunId: null, imageError: '1688 상품 이미지가 발견되지 않았습니다.' }
        }))
        return
      }

      if (message.type === 'FUNTASTIC_1688_DETAIL_IMAGES_ACK') {
        setJobs((current) => current.map((job) => (
          job.imageRunId === message.runId
            ? { ...job, imageAcknowledged: true }
            : job
        )))
        return
      }

      if (message.type === 'FUNTASTIC_1688_DETAIL_IMAGES_ERROR') {
        setJobs((current) => current.map((job) => (
          job.imageRunId === message.runId
            ? { ...job, status: 'asset_pending', imageRunId: null, imageError: message.message || '1688 이미지 수집에 실패했습니다.' }
            : job
        )))
      }
    }

    window.addEventListener('message', onMessage)
    window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_1688_PING' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function createJobs() {
    if (selectedDraftProducts.length === 0) return
    const createdAt = new Date().toLocaleString('ko-KR')
    const created = selectedDraftProducts.map((product, index) => ({
      id: `${product.id}-${Date.now()}-${index}`,
      product,
      status: 'asset_pending' as const,
      template,
      note: note.trim(),
      createdAt,
      images: [],
      imageRunId: null,
      imageAcknowledged: false,
      imageError: null,
    }))
    setJobs((current) => [...created, ...current])
    setActiveId(created[0]?.id ?? null)
    excludeDraftProducts(selectedDraftProducts)
  }

  function excludeDraftProducts(products: DetailPageProduct[]) {
    if (products.length === 0) return
    const excludedIds = new Set(products.map((product) => product.id))
    setConsumedProductIds((current) => new Set([...current, ...excludedIds]))
    setSelectedDraftIds(new Set())

    if (selectedProducts.length > 0 || typeof window === 'undefined') return
    const remainingProducts = sessionProducts.filter((product) => !excludedIds.has(product.id))
    cachedSessionProducts = remainingProducts
    if (remainingProducts.length > 0) {
      window.sessionStorage.setItem(DETAIL_PAGE_SELECTION_KEY, JSON.stringify(remainingProducts))
    } else {
      window.sessionStorage.removeItem(DETAIL_PAGE_SELECTION_KEY)
    }
  }

  function toggleDraftSelection(productId: string) {
    setSelectedDraftIds((current) => {
      const next = new Set(current)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
    setActiveId(null)
  }

  function toggleAllDrafts() {
    setSelectedDraftIds(allDraftsSelected ? new Set() : new Set(draftProducts.map((product) => product.id)))
    setActiveId(null)
  }

  function moveJob(status: DetailPageJob['status']) {
    if (!activeJob) return
    setJobs((current) => current.map((job) => job.id === activeJob.id ? { ...job, status } : job))
  }

  function startImageCollection() {
    if (!activeJob) return
    if (!activeJob.product.purchaseUrl) {
      setJobs((current) => current.map((job) => (
        job.id === activeJob.id
          ? { ...job, imageError: '품목에 구매 URL이 없어 1688 이미지를 수집할 수 없습니다.' }
          : job
      )))
      return
    }

    const runId = createRunId()
    setJobs((current) => current.map((job) => (
      job.id === activeJob.id
        ? { ...job, status: 'collecting', imageRunId: runId, imageAcknowledged: false, imageError: null }
        : job
    )))
    window.postMessage({
      source: PAGE_SOURCE,
      type: 'FUNTASTIC_1688_DETAIL_IMAGES_START',
      runId,
      jobId: activeJob.id,
      url: normalizeUrl(activeJob.product.purchaseUrl),
    }, window.location.origin)

    window.setTimeout(() => {
      setJobs((current) => current.map((job) => (
        job.id === activeJob.id && job.imageRunId === runId && !job.imageAcknowledged
          ? { ...job, status: 'asset_pending', imageRunId: null, imageError: '확장프로그램이 응답하지 않습니다. 확장프로그램을 다시 로드한 뒤 재시도해주세요.' }
          : job
      )))
    }, 8_000)
  }

  return (
    <section className="overflow-hidden border bg-background">
      <div className="grid min-h-[680px] lg:grid-cols-[minmax(330px,0.8fr)_minmax(520px,1.2fr)]">
        <aside className="border-b bg-muted/20 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">제작 대기열</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{jobs.length + draftProducts.length}건</p>
            </div>
            <div className="flex items-center gap-1.5">
              {hasDraftProducts ? (
                <label className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium">
                  <input type="checkbox" checked={allDraftsSelected} onChange={toggleAllDrafts} className="size-3.5 accent-foreground" aria-label="대기 품목 전체 선택" />
                  전체
                </label>
              ) : null}
              {selectedDraftProducts.length > 0 ? (
                <Button type="button" size="sm" variant="outline" onClick={() => excludeDraftProducts(selectedDraftProducts)} className="text-destructive hover:text-destructive" title="선택한 품목을 상세페이지 대기열에서만 제외합니다.">
                  <Trash2 />선택 삭제 {selectedDraftProducts.length}
                </Button>
              ) : null}
              <Button type="button" size="icon-sm" variant="outline" onClick={() => setActiveId(null)} aria-label="새 작업 설정" title="새 작업 설정">
                <Plus />
              </Button>
            </div>
          </div>

          <div className="divide-y">
            {draftProducts.map((product) => (
              <QueueDraft
                key={product.id}
                product={product}
                selected={selectedDraftIds.has(product.id)}
                onSelectedChange={() => toggleDraftSelection(product.id)}
              />
            ))}
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => setActiveId(job.id)}
                className={`grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/70 ${activeId === job.id ? 'bg-muted' : 'bg-background'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{job.product.name}</span>
                  <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{job.product.sku}{job.product.option ? ` · ${job.product.option}` : ''}</span>
                </span>
                <Badge variant="outline" className={STATUS[job.status].className}>{STATUS[job.status].label}</Badge>
              </button>
            ))}
            {!hasDraftProducts && jobs.length === 0 ? (
              <div className="px-4 py-16 text-center text-sm text-muted-foreground">품목에서 상세페이지 제작을 시작하면 여기에 작업이 생성됩니다.</div>
            ) : null}
          </div>
        </aside>

        <main className="min-w-0">
          {hasDraftProducts || activeJob ? (
            <>
              <div className="border-b px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">{activeProduct.name}</h2>
                      {activeJob ? <Badge variant="outline" className={STATUS[activeJob.status].className}>{STATUS[activeJob.status].label}</Badge> : <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">작업 설정</Badge>}
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {activeProduct.sku}{activeProduct.option ? ` · ${activeProduct.option}` : ''}
                      {!activeJob && selectedDraftProducts.length > 0 ? ` · ${selectedDraftProducts.length}개 선택` : ''}
                    </p>
                  </div>
                  {activeProduct.purchaseUrl ? (
                    <a href={normalizeUrl(activeProduct.purchaseUrl)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-muted">
                      <Link2 className="size-3.5" />구매 URL<ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_260px]">
                <div className="min-w-0 divide-y">
                  <section className="px-5 py-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">품목 참조 정보</h3>
                      {missingFields.length ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800"><CircleAlert />정보 보완 필요</Badge> : <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800"><Check />준비됨</Badge>}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                      <Info label="재질" value={activeProduct.material} />
                      <Info label="제품크기" value={activeProduct.size} />
                      <Info label="제조사" value={activeProduct.manufacturer} />
                      <Info label="무게" value={activeProduct.weight} />
                      <Info label="제조국" value={activeProduct.country} />
                      <Info label="용량" value={activeProduct.capacity} />
                    </dl>
                    {missingFields.length ? <p className="mt-4 text-xs text-amber-700">누락 항목: {missingFields.join(', ')}</p> : null}
                  </section>

                  {!activeJob ? (
                    <section className="space-y-4 px-5 py-4">
                      <h3 className="text-sm font-semibold">제작 설정{selectedDraftProducts.length > 0 ? ` · ${selectedDraftProducts.length}개 일괄 적용` : ''}</h3>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">Figma 템플릿</span>
                          <select value={template} onChange={(event) => setTemplate(event.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                            <option>기본 상품 상세</option>
                            <option>생활용품 상세</option>
                            <option>패션/잡화 상세</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-muted-foreground">제작 메모</span>
                          <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="강조할 포인트 입력" />
                        </label>
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" onClick={createJobs} disabled={selectedDraftProducts.length === 0}>
                          <WandSparkles />선택 작업 생성{selectedDraftProducts.length > 0 ? ` ${selectedDraftProducts.length}` : ''}
                        </Button>
                      </div>
                    </section>
                  ) : (
                    <section className="px-5 py-4">
                      <h3 className="text-sm font-semibold">작업 진행</h3>
                      <ol className="mt-4 grid gap-3 sm:grid-cols-4">
                        <WorkflowStep icon={Clock3} label="작업 생성" active />
                        <WorkflowStep icon={ImagePlus} label="이미지 수집" active={activeJob.status !== 'asset_pending'} />
                        <WorkflowStep icon={WandSparkles} label="초안 제작" active={activeJob.status === 'review' || activeJob.status === 'completed'} />
                        <WorkflowStep icon={FilePenLine} label="Figma 검수" active={activeJob.status === 'completed'} />
                      </ol>
                      <div className="mt-5 flex flex-wrap gap-2">
                        {activeJob.status === 'asset_pending' ? <Button type="button" variant="outline" onClick={startImageCollection} disabled={!extensionReady}><ImagePlus />이미지 수집 시작</Button> : null}
                        {activeJob.status === 'collecting' ? <Button type="button" variant="outline" onClick={() => moveJob('review')}><WandSparkles />Figma 초안 생성</Button> : null}
                        {activeJob.status === 'review' ? <Button type="button" onClick={() => moveJob('completed')}><FilePenLine />Figma 검수 완료</Button> : null}
                        {activeJob.status === 'completed' ? <Badge variant="outline" className="h-8 border-emerald-200 bg-emerald-50 px-3 text-emerald-800"><Check />Figma 링크 저장 예정</Badge> : null}
                      </div>
                      {activeJob.imageError ? <p className="mt-3 text-xs text-destructive">{activeJob.imageError}</p> : null}
                    </section>
                  )}
                </div>

                <aside className="border-t bg-muted/20 px-5 py-4 xl:border-t-0 xl:border-l">
                  <h3 className="text-sm font-semibold">Figma 파일</h3>
                  <div className="mt-3 border border-dashed bg-background px-3 py-4 text-center">
                    <PanelsTopLeft className="mx-auto size-5 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">{activeJob?.status === 'completed' ? '편집 파일 준비됨' : '편집 파일 대기'}</p>
                    <p className="mt-1 text-xs text-muted-foreground">완료 후 이 작업과 품목에 같은 링크가 표시됩니다.</p>
                  </div>
                  {activeJob?.images.length ? (
                    <div className="mt-4">
                      <p className="text-xs font-medium">수집 이미지 {activeJob.images.length}장</p>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {activeJob.images.slice(0, 9).map((imageUrl) => (
                          <a key={imageUrl} href={imageUrl} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden border bg-background">
                            <img src={imageUrl} alt={`${activeJob.product.name} 수집 이미지`} className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {activeJob?.note ? <p className="mt-4 text-xs text-muted-foreground">메모: {activeJob.note}</p> : null}
                  {activeJob ? <p className="mt-2 text-xs text-muted-foreground">생성: {activeJob.createdAt}</p> : null}
                </aside>
              </div>
            </>
          ) : (
            <div className="flex min-h-[680px] flex-col items-center justify-center p-8 text-center">
              <PanelsTopLeft className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">품목에서 작업을 시작해주세요.</p>
              <p className="mt-1 text-xs text-muted-foreground">품목의 구매 URL과 상품 정보를 작업 기준으로 가져옵니다.</p>
            </div>
          )}
        </main>
      </div>
    </section>
  )
}

function QueueDraft({
  product,
  selected,
  onSelectedChange,
}: {
  product: DetailPageProduct
  selected: boolean
  onSelectedChange: () => void
}) {
  return (
    <label className={`grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/70 ${selected ? 'bg-muted' : 'bg-background'}`}>
      <input type="checkbox" checked={selected} onChange={onSelectedChange} className="mt-0.5 size-4 accent-foreground" aria-label={`${product.name} 선택`} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{product.name}</span>
        <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">{product.sku}{product.option ? ` · ${product.option}` : ''}</span>
      </span>
      <Badge variant="outline" className={STATUS.draft.className}>{STATUS.draft.label}</Badge>
    </label>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 min-h-5 truncate font-medium" title={value || undefined}>{value || '-'}</dd></div>
}

function WorkflowStep({ icon: Icon, label, active }: { icon: typeof Clock3; label: string; active: boolean }) {
  return (
    <li className={`flex items-center gap-2 border px-3 py-2 text-sm ${active ? 'border-foreground bg-background' : 'border-border bg-muted/30 text-muted-foreground'}`}>
      {active ? <LoaderCircle className="size-4" /> : <Icon className="size-4" />}
      <span>{label}</span>
    </li>
  )
}

function normalizeUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function normalizeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const images = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || images.size >= 30) continue
    try {
      const url = new URL(entry.startsWith('//') ? `https:${entry}` : entry)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      images.add(url.toString())
    } catch {
      // Ignore malformed image addresses from the page.
    }
  }
  return Array.from(images)
}

function createRunId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `detail-images-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isDetailPageProduct(value: unknown): value is DetailPageProduct {
  if (!value || typeof value !== 'object') return false
  const product = value as Partial<DetailPageProduct>
  return typeof product.id === 'string'
    && typeof product.sku === 'string'
    && typeof product.name === 'string'
    && typeof product.option === 'string'
    && typeof product.purchaseUrl === 'string'
    && typeof product.material === 'string'
    && typeof product.size === 'string'
    && typeof product.manufacturer === 'string'
    && typeof product.weight === 'string'
    && typeof product.country === 'string'
    && typeof product.capacity === 'string'
}

function subscribeToSessionProducts() {
  return () => {}
}

function readSessionProducts() {
  if (cachedSessionProducts) return cachedSessionProducts
  if (typeof window === 'undefined') return EMPTY_PRODUCTS
  try {
    const saved = window.sessionStorage.getItem(DETAIL_PAGE_SELECTION_KEY)
    const parsed = saved ? JSON.parse(saved) : []
    cachedSessionProducts = Array.isArray(parsed) ? parsed.filter(isDetailPageProduct) : EMPTY_PRODUCTS
  } catch {
    cachedSessionProducts = EMPTY_PRODUCTS
  }
  return cachedSessionProducts
}
