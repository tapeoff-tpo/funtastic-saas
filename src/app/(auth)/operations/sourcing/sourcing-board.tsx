'use client'

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, Image as ImageIcon, Link2, Plus, Search, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  addSourcingCandidateAction,
  createSourcingItemAction,
  selectSourcingCandidateAction,
  updateSourcingItemStatusAction,
} from './actions'

type SourcingCandidateRow = {
  id: string
  itemId: string
  platform: string
  title: string | null
  candidateUrl: string
  imageUrl: string | null
  priceText: string | null
  supplierName: string | null
  matchScore: number | null
  isSelected: boolean
  memo: string | null
  createdAt: string
}

type SourcingItemRow = {
  id: string
  sourcePlatform: string
  sourceTitle: string
  sourceUrl: string | null
  imageUrl: string | null
  category: string | null
  sourceRank: number | null
  sourcePrice: number | null
  keyword: string | null
  status: string
  selected1688Url: string | null
  selectedAt: string | null
  memo: string | null
  createdAt: string
  updatedAt: string
  candidates: SourcingCandidateRow[]
}

type Props = {
  items: SourcingItemRow[]
  statusLabels: Record<string, string>
}

type CoupangCapturePayload = {
  captureId?: string
  sourceTitle: string
  sourceUrl?: string | null
  imageUrl?: string | null
  category?: string | null
  sourceRank?: number | null
  sourcePrice?: number | null
  keyword?: string | null
  memo?: string | null
}

const PAGE_SOURCE = 'funtastic-saas'
const EXTENSION_SOURCE = 'funtastic-coupang-sourcing-extension'

const STATUS_TONE: Record<string, string> = {
  captured: 'bg-slate-50 text-slate-700 ring-slate-200',
  searching: 'bg-blue-50 text-blue-700 ring-blue-200',
  candidate_review: 'bg-amber-50 text-amber-800 ring-amber-200',
  selected: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ignored: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
}

function won(value: number | null) {
  return value == null || value === 0 ? '-' : `${value.toLocaleString('ko-KR')}원`
}

function dateText(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function compactUrl(value: string | null) {
  if (!value) return '-'
  try {
    const url = new URL(value)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return 'URL'
  }
}

function imageBackground(url: string | null): CSSProperties | undefined {
  return url ? { backgroundImage: `url(${JSON.stringify(url)})` } : undefined
}

function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ring-1', STATUS_TONE[status] ?? STATUS_TONE.captured)}>
      {labels[status] ?? status}
    </span>
  )
}

export function SourcingBoard({ items, statusLabels }: Props) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [extensionConnected, setExtensionConnected] = useState(false)
  const processedCaptureIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    async function saveCapture(capture: CoupangCapturePayload) {
      const captureId = capture.captureId || `${capture.sourceUrl || ''}|${capture.sourceTitle}`
      if (!capture.sourceTitle || processedCaptureIds.current.has(captureId)) return
      processedCaptureIds.current.add(captureId)

      try {
        const response = await fetch('/api/operations/sourcing/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceTitle: capture.sourceTitle,
            sourceUrl: capture.sourceUrl || null,
            imageUrl: capture.imageUrl || null,
            category: capture.category || null,
            sourceRank: capture.sourceRank ?? null,
            sourcePrice: capture.sourcePrice ?? null,
            keyword: capture.keyword || null,
            memo: capture.memo || null,
          }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || '쿠팡 상품을 저장하지 못했습니다.')

        window.postMessage({
          source: PAGE_SOURCE,
          type: 'FUNTASTIC_COUPANG_CAPTURE_SAVED',
          captureId,
          itemId: result.id,
        }, window.location.origin)
        toast.success(result.updated ? '쿠팡 소싱 상품을 갱신했습니다.' : '쿠팡 소싱 상품을 저장했습니다.')
        router.refresh()
      } catch (error) {
        processedCaptureIds.current.delete(captureId)
        toast.error(error instanceof Error ? error.message : '쿠팡 상품 저장에 실패했습니다.')
      }
    }

    function handleMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return
      const message = event.data
      if (!message || message.source !== EXTENSION_SOURCE || typeof message.type !== 'string') return

      if (message.type === 'FUNTASTIC_COUPANG_PONG') {
        setExtensionConnected(true)
        if (Number(message.pendingCount) > 0) {
          window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_COUPANG_GET_PENDING' }, window.location.origin)
        }
        return
      }

      if (message.type === 'FUNTASTIC_COUPANG_CAPTURED' && message.capture) {
        setExtensionConnected(true)
        void saveCapture(message.capture)
        return
      }

      if (message.type === 'FUNTASTIC_COUPANG_PENDING' && Array.isArray(message.captures)) {
        setExtensionConnected(true)
        for (const capture of message.captures) void saveCapture(capture)
        return
      }

      if (message.type === 'FUNTASTIC_COUPANG_ERROR') {
        toast.error(message.message || '쿠팡 소싱 확장프로그램 오류가 발생했습니다.')
      }
    }

    window.addEventListener('message', handleMessage)
    window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_COUPANG_PING' }, window.location.origin)
    window.setTimeout(() => {
      window.postMessage({ source: PAGE_SOURCE, type: 'FUNTASTIC_COUPANG_GET_PENDING' }, window.location.origin)
    }, 500)

    return () => window.removeEventListener('message', handleMessage)
  }, [router])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return items.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (!normalizedQuery) return true
      return [
        item.sourceTitle,
        item.keyword,
        item.category,
        item.memo,
        item.selected1688Url,
      ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery))
    })
  }, [items, query, statusFilter])

  const selected = items.find((item) => item.id === selectedId) ?? filteredItems[0] ?? items[0] ?? null
  const selectedCandidate = selected?.candidates.find((candidate) => candidate.isSelected) ?? null
  const stats = useMemo(() => ({
    total: items.length,
    review: items.filter((item) => item.status === 'candidate_review').length,
    selected: items.filter((item) => item.status === 'selected').length,
    missing: items.filter((item) => item.candidates.length === 0).length,
  }), [items])

  async function createItem(formData: FormData) {
    await createSourcingItemAction(formData)
  }

  async function addCandidate(formData: FormData) {
    await addSourcingCandidateAction(formData)
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-md border bg-background">
        <div className="grid gap-3 border-b px-4 py-3 lg:grid-cols-[minmax(0,1fr)_520px] lg:items-end">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Metric label="전체" value={stats.total} />
            <Metric label="후보 검토" value={stats.review} />
            <Metric label="소싱 확정" value={stats.selected} />
            <Metric label="후보 없음" value={stats.missing} />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <div className="relative min-w-60 flex-1 lg:max-w-72">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="상품명, 키워드, URL"
                className="pl-8"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-8 rounded-lg border bg-background px-2.5 text-sm"
              aria-label="상태 필터"
            >
              <option value="all">전체 상태</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <span className={cn(
              'inline-flex h-8 items-center rounded-full px-3 text-xs font-medium ring-1',
              extensionConnected
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : 'bg-muted text-muted-foreground ring-border',
            )}>
              쿠팡 확장 {extensionConnected ? '연결됨' : '대기'}
            </span>
          </div>
        </div>

        <form action={createItem} className="grid gap-3 border-b bg-muted/20 px-4 py-3 xl:grid-cols-[1.2fr_1fr_1fr_90px_110px_120px_auto]">
          <Input required name="sourceTitle" placeholder="쿠팡 상품명" />
          <Input name="sourceUrl" placeholder="쿠팡 URL" />
          <Input name="imageUrl" placeholder="이미지 URL" />
          <Input name="sourceRank" inputMode="numeric" placeholder="랭킹" />
          <Input name="sourcePrice" inputMode="numeric" placeholder="가격" />
          <Input name="keyword" placeholder="키워드" />
          <Button type="submit" className="h-8">
            <Plus className="h-4 w-4" />
            추가
          </Button>
          <Input name="category" placeholder="카테고리" className="xl:col-span-2" />
          <Input name="memo" placeholder="메모" className="xl:col-span-5" />
        </form>

        <div className="grid min-h-[560px] xl:grid-cols-[minmax(660px,1fr)_520px]">
          <div className="min-w-0 overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[52px_minmax(260px,1fr)_90px_90px_90px_110px_100px] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                <span>No.</span>
                <span>쿠팡 상품</span>
                <span>랭킹</span>
                <span>가격</span>
                <span>후보</span>
                <span>상태</span>
                <span>기록일</span>
              </div>
              {filteredItems.map((item, index) => {
                const active = selected?.id === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'grid w-full grid-cols-[52px_minmax(260px,1fr)_90px_90px_90px_110px_100px] items-center gap-3 border-b px-4 py-3 text-left text-sm hover:bg-muted/40',
                      active && 'bg-muted/60',
                    )}
                  >
                    <span className="text-xs text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{item.sourceTitle}</span>
                      <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{item.keyword || item.category || '-'}</span>
                        {item.sourceUrl ? <ExternalLink className="h-3.5 w-3.5 shrink-0" /> : null}
                      </span>
                    </span>
                    <span>{item.sourceRank ? `${item.sourceRank}위` : '-'}</span>
                    <span>{won(item.sourcePrice)}</span>
                    <span>{item.candidates.length}개</span>
                    <StatusBadge status={item.status} labels={statusLabels} />
                    <span className="text-xs text-muted-foreground">{dateText(item.createdAt)}</span>
                  </button>
                )
              })}
              {!filteredItems.length ? (
                <div className="px-4 py-16 text-center text-sm text-muted-foreground">표시할 소싱 상품이 없습니다.</div>
              ) : null}
            </div>
          </div>

          <aside className="border-t bg-background xl:border-l xl:border-t-0">
            {selected ? (
              <div className="flex h-full flex-col">
                <div className="border-b p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold">{selected.sourceTitle}</h2>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {selected.keyword || selected.category || '쿠팡'} · {won(selected.sourcePrice)}
                      </p>
                    </div>
                    <StatusBadge status={selected.status} labels={statusLabels} />
                  </div>
                  <div className="mt-3 grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                    <div className="grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted/30">
                      {selected.imageUrl ? (
                        <div className="h-full w-full bg-cover bg-center" style={imageBackground(selected.imageUrl)} />
                      ) : (
                        <ImageIcon className="h-7 w-7 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 space-y-2 text-sm">
                      <LinkRow label="쿠팡" href={selected.sourceUrl} />
                      <LinkRow label="1688" href={selected.selected1688Url} />
                      {selected.memo ? <p className="line-clamp-2 text-xs text-muted-foreground">{selected.memo}</p> : null}
                    </div>
                  </div>
                </div>

                <div className="space-y-3 border-b p-4">
                  <form action={updateSourcingItemStatusAction} className="flex items-end gap-2">
                    <input type="hidden" name="itemId" value={selected.id} />
                    <label className="min-w-0 flex-1 space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">상태</span>
                      <select name="status" defaultValue={selected.status} className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm">
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <Button type="submit" variant="outline">변경</Button>
                  </form>

                  <form action={addCandidate} className="grid gap-2">
                    <input type="hidden" name="itemId" value={selected.id} />
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
                      <Input required name="candidateUrl" placeholder="1688 후보 URL" />
                      <Input name="priceText" placeholder="가격" />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                      <Input name="title" placeholder="1688 상품명" />
                      <Input name="supplierName" placeholder="공급처" />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_auto]">
                      <Input name="imageUrl" placeholder="후보 이미지 URL" />
                      <Input name="matchScore" inputMode="numeric" placeholder="점수" />
                      <Button type="submit">
                        <Plus className="h-4 w-4" />
                        후보 추가
                      </Button>
                    </div>
                    <Input name="memo" placeholder="후보 메모" />
                  </form>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <h3 className="text-sm font-semibold">1688 후보 {selected.candidates.length}개</h3>
                  <div className="mt-3 space-y-2">
                    {selected.candidates.map((candidate) => (
                      <div key={candidate.id} className={cn('rounded-md border p-3', candidate.isSelected && 'border-emerald-300 bg-emerald-50/60')}>
                        <div className="flex items-start gap-3">
                          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded border bg-background">
                            {candidate.imageUrl ? (
                              <div className="h-full w-full bg-cover bg-center" style={imageBackground(candidate.imageUrl)} />
                            ) : (
                              <ImageIcon className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{candidate.title || compactUrl(candidate.candidateUrl)}</p>
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                  {candidate.supplierName || '1688'} · {candidate.priceText || '-'}
                                </p>
                              </div>
                              {candidate.isSelected ? (
                                <span className="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-100 px-2 text-xs font-medium text-emerald-700">
                                  <Star className="h-3.5 w-3.5 fill-emerald-600" />
                                  확정
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <a
                                href={candidate.candidateUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-muted"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                열기
                              </a>
                              {!candidate.isSelected ? (
                                <form action={selectSourcingCandidateAction}>
                                  <input type="hidden" name="itemId" value={selected.id} />
                                  <input type="hidden" name="candidateId" value={candidate.id} />
                                  <Button type="submit" size="sm">
                                    <Check className="h-3.5 w-3.5" />
                                    확정
                                  </Button>
                                </form>
                              ) : null}
                              {candidate.matchScore != null ? <span className="text-xs text-muted-foreground">점수 {candidate.matchScore}</span> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {!selected.candidates.length ? (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                        1688 후보가 없습니다.
                      </div>
                    ) : null}
                  </div>
                </div>

                {selectedCandidate ? (
                  <div className="border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                    확정 URL: <span className="font-medium text-foreground">{compactUrl(selectedCandidate.candidateUrl)}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid h-full place-items-center p-8 text-sm text-muted-foreground">소싱 상품을 선택해 주세요.</div>
            )}
          </aside>
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value.toLocaleString('ko-KR')}</p>
    </div>
  )
}

function LinkRow({ label, href }: { label: string; href: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-10 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 text-xs font-medium hover:underline"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{compactUrl(href)}</span>
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      )}
    </div>
  )
}
