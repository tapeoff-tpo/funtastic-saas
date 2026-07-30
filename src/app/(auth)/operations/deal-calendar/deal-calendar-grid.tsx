'use client'

import { useMemo, useState } from 'react'
import { BarChart3, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, List, Plus, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { createDealEventAction, updateDealChecklistAction, updateDealPerformanceAction, updateDealStatusAction } from './actions'

type DealChecklistItem = { key: string; label: string; completed: boolean }

export type DealCalendarItem = {
  id: string
  platform: string
  dealType: string
  title: string
  productCode: string | null
  options: string | null
  dealPrice: number
  unitCost: number | null
  shippingCost: number
  stock: number
  dailyCapacity: number
  startsOn: string
  endsOn: string
  applicationStartsOn: string | null
  applicationEndsOn: string | null
  minimumDiscountRate: number | null
  appliedProductCount: number | null
  discountCode: string | null
  externalPromotionId: string | null
  campaignName: string | null
  dailyBudget: number | null
  searchBid: number | null
  recommendationBid: number | null
  status: string
  contact: string | null
  notes: string | null
  checklist: DealChecklistItem[]
  soldQuantity: number
  salesAmount: number
}

type ViewMode = 'calendar' | 'list' | 'performance'
type DealStageFilter = 'all' | 'registered' | 'planned'

const TYPE_LABELS: Record<string, string> = { today: '오늘의딜', talkdeal: '톡딜', one_plus_one: '1+1톡딜', under_10000: '만원톡딜', always_on: '상시딜', promotion: '프로모션', ad_campaign: '광고 캠페인', promotion_application: '프로모션 신청' }
const STATUS_LABELS: Record<string, string> = { draft: '작성 중', registered: '등록', application_pending: '신청 대기', submitted: '제안 완료', applied: '신청 완료', selected: '선정', planned: '선정·플랜확정', setup_complete: '설정 완료', live: '진행 중', ended: '종료', rejected: '미선정' }
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initialMonth(events: DealCalendarItem[]) {
  const now = new Date()
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  if (events.some((event) => event.startsOn.startsWith(current))) return current
  return events.map((event) => event.startsOn).sort()[0]?.slice(0, 7) ?? current
}

function won(value: number | null) {
  return value == null || value === 0 ? '-' : `${value.toLocaleString('ko-KR')}원`
}

function eventSales(event: DealCalendarItem) {
  return event.salesAmount || event.dealPrice * event.soldQuantity
}

function isStandingDeal(event: DealCalendarItem) {
  return event.dealType === 'always_on'
}

function statusTone(status: string) {
  if (status === 'registered' || status === 'submitted' || status === 'applied') return 'border-blue-200 bg-blue-50 text-blue-700'
  if (status === 'selected' || status === 'planned' || status === 'setup_complete') return 'border-violet-200 bg-violet-50 text-violet-700'
  if (status === 'live') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'rejected') return 'border-red-200 bg-red-50 text-red-700'
  return 'border-muted bg-muted/40 text-muted-foreground'
}

function eventWarnings(events: DealCalendarItem[]) {
  const warnings: Record<string, string[]> = {}
  const add = (id: string, message: string) => {
    warnings[id] = warnings[id] || []
    if (!warnings[id].includes(message)) warnings[id].push(message)
  }

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.productCode && event.platform !== '10x10' && event.dealType !== 'ad_campaign') {
      const days = Math.max(1, Math.round((new Date(`${event.endsOn}T00:00:00`).getTime() - new Date(`${event.startsOn}T00:00:00`).getTime()) / 86_400_000) + 1)
      if (event.stock < event.dailyCapacity * days) add(event.id, `행사 최대 출고량 ${event.dailyCapacity * days}개 대비 재고가 ${event.stock}개입니다.`)
    }
    for (let otherIndex = index + 1; otherIndex < events.length; otherIndex += 1) {
      const other = events[otherIndex]
      if (!event.productCode || event.productCode !== other.productCode) continue
      if (event.startsOn <= other.endsOn && other.startsOn <= event.endsOn) {
        add(event.id, `같은 상품코드가 '${other.title}' 행사와 겹칩니다.`)
        add(other.id, `같은 상품코드가 '${event.title}' 행사와 겹칩니다.`)
      }
    }
  }
  return warnings
}

export function DealCalendarGrid({ events }: { events: DealCalendarItem[] }) {
  const [monthKey, setMonthKey] = useState(() => initialMonth(events))
  const [dealStage, setDealStage] = useState<DealStageFilter>('all')
  const [view, setView] = useState<ViewMode>('calendar')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const selected = events.find((event) => event.id === selectedId) ?? null
  const [year, month] = monthKey.split('-').map(Number)
  const today = dateKey(new Date())
  const registeredDeals = events.filter((event) => ['registered', 'submitted', 'applied'].includes(event.status))
  const plannedDeals = events.filter((event) => ['selected', 'planned', 'setup_complete'].includes(event.status))
  const todos = events.filter((event) => ['registered', 'submitted', 'applied', 'selected'].includes(event.status) && !isStandingDeal(event))
  const datedEvents = events.filter((event) => !isStandingDeal(event))
  const warnings = useMemo(() => eventWarnings(datedEvents), [datedEvents])
  const warningEvents = datedEvents.filter((event) => warnings[event.id]?.length)

  const days = useMemo(() => {
    const first = new Date(year, month - 1, 1)
    const leadingDays = (first.getDay() + 6) % 7
    const gridStart = new Date(year, month - 1, 1 - leadingDays)
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + index)
      return date
    })
  }, [month, year])

  const standingDeals = events.filter(isStandingDeal)
  const visibleRegisteredDeals = registeredDeals
  const visiblePlannedDeals = plannedDeals
  const productRows = (() => {
    const grouped = new Map<string, {
      key: string
      title: string
      productCode: string | null
      dealCount: number
      soldQuantity: number
      salesAmount: number
      latestEndsOn: string
    }>()
    for (const event of events) {
      const key = event.productCode || `title:${event.title}`
      const current = grouped.get(key) || {
        key,
        title: event.title,
        productCode: event.productCode,
        dealCount: 0,
        soldQuantity: 0,
        salesAmount: 0,
        latestEndsOn: event.endsOn,
      }
      current.dealCount += 1
      current.soldQuantity += event.soldQuantity
      current.salesAmount += eventSales(event)
      if (event.endsOn > current.latestEndsOn) {
        current.latestEndsOn = event.endsOn
        current.title = event.title
      }
      grouped.set(key, current)
    }
    return Array.from(grouped.values()).sort((left, right) => right.latestEndsOn.localeCompare(left.latestEndsOn))
  })()
  const totalSoldQuantity = events.reduce((total, event) => total + event.soldQuantity, 0)
  const totalSalesAmount = events.reduce((total, event) => total + eventSales(event), 0)
  const filteredEvents = datedEvents.filter((event) => {
    if (dealStage === 'registered') return ['registered', 'submitted', 'applied'].includes(event.status)
    if (dealStage === 'planned') return ['selected', 'planned', 'setup_complete'].includes(event.status)
    return true
  })

  function changeMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1)
    setMonthKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }

  function markersFor(day: string) {
    const markers: DealCalendarItem[] = []
    for (const event of filteredEvents) {
      if (day >= event.startsOn && day <= event.endsOn) markers.push(event)
    }
    return markers
  }

  return (
    <>
      <section className="overflow-hidden rounded-md border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <b>전체 {events.length}건</b>
            <span className="text-muted-foreground">등록한 딜 <b className="text-blue-700">{registeredDeals.length}건</b></span>
            <span className="text-muted-foreground">선정·플랜 <b className="text-violet-700">{plannedDeals.length}건</b></span>
            <span className="text-muted-foreground">상시딜 <b className="text-foreground">{events.filter(isStandingDeal).length}건</b></span>
            <span className="text-muted-foreground">후속 작업 <b className={cn(todos.length && 'text-amber-700', !todos.length && 'text-foreground')}>{todos.length}건</b></span>
            <span className="text-muted-foreground">주의 필요 <b className={cn(warningEvents.length && 'text-red-700', !warningEvents.length && 'text-foreground')}>{warningEvents.length}건</b></span>
            <span className="text-muted-foreground">딜 판매 <b className="text-foreground">{totalSoldQuantity.toLocaleString('ko-KR')}개</b></span>
            <span className="text-muted-foreground">딜 매출 <b className="text-foreground">{won(totalSalesAmount)}</b></span>
          </div>
          <Button type="button" size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" />일정 추가</Button>
        </div>

        <div className="grid xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex min-w-0 items-center gap-1">
                <button type="button" aria-label="이전 달" title="이전 달" onClick={() => changeMonth(-1)} className="grid size-8 place-items-center rounded border hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
                <h2 className="min-w-32 text-center text-base font-semibold">{year}년 {month}월</h2>
                <button type="button" aria-label="다음 달" title="다음 달" onClick={() => changeMonth(1)} className="grid size-8 place-items-center rounded border hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={dealStage} onChange={(event) => setDealStage(event.target.value as DealStageFilter)} aria-label="딜 단계 필터" className="h-8 rounded border bg-background px-2 text-xs">
                  <option value="all">분류 전체</option>
                  <option value="registered">등록한 딜</option>
                  <option value="planned">선정·플랜</option>
                </select>
                <div className="flex rounded border p-0.5">
                  <button type="button" title="캘린더 보기" onClick={() => setView('calendar')} className={cn('grid size-7 place-items-center', view === 'calendar' ? 'bg-foreground text-background' : 'hover:bg-muted')}><CalendarDays className="h-4 w-4" /></button>
                  <button type="button" title="목록 보기" onClick={() => setView('list')} className={cn('grid size-7 place-items-center', view === 'list' ? 'bg-foreground text-background' : 'hover:bg-muted')}><List className="h-4 w-4" /></button>
                  <button type="button" title="상품·성과 보기" onClick={() => setView('performance')} className={cn('flex h-7 items-center gap-1 px-2 text-xs font-medium', view === 'performance' ? 'bg-foreground text-background' : 'hover:bg-muted')}><BarChart3 className="h-4 w-4" />상품·성과</button>
                </div>
              </div>
            </div>

            {view === 'calendar' ? (
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-xs text-muted-foreground">{WEEKDAYS.map((weekday) => <div key={weekday} className="py-2">{weekday}</div>)}</div>
                  <div className="grid grid-cols-7">
                    {days.map((date) => {
                      const day = dateKey(date)
                      const markers = markersFor(day)
                      const inMonth = date.getMonth() === month - 1
                      return (
                        <div key={day} className={cn('min-h-24 border-b border-r p-1.5', inMonth ? 'bg-background' : 'bg-muted/20')}>
                          <span className={cn('text-xs', inMonth ? 'text-foreground' : 'text-muted-foreground/50', day === today && 'inline-grid size-5 place-items-center rounded-full bg-foreground text-background')}>{date.getDate()}</span>
                          <div className="mt-1 space-y-1">
                            {markers.slice(0, 2).map((event) => <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className="block w-full truncate rounded-sm border-l-2 border-l-emerald-500 bg-muted/50 px-1.5 py-1 text-left text-[10px] font-medium text-emerald-800 hover:bg-muted" title={`행사 기간 · ${event.title}${warnings[event.id]?.length ? ' · 주의 필요' : ''}`}>{warnings[event.id]?.length ? '! ' : ''}{event.title}</button>)}
                            {markers.length > 2 && <p className="px-1 text-[10px] text-muted-foreground">+{markers.length - 2}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : view === 'list' ? (
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[minmax(240px,1fr)_120px_180px_90px] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground"><span>일정</span><span>구분</span><span>행사 기간</span><span>상태</span></div>
                  {filteredEvents.map((event) => {
                    const period = `${event.startsOn} ~ ${event.endsOn}`
                    return <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className="grid w-full grid-cols-[minmax(240px,1fr)_120px_180px_90px] items-center gap-3 border-b px-4 py-3 text-left text-sm hover:bg-muted/50"><b className="flex min-w-0 items-center gap-1.5">{warnings[event.id]?.length ? <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-red-600" /> : null}<span className="truncate">{event.title}</span></b><span className="text-muted-foreground">{TYPE_LABELS[event.dealType] ?? event.dealType}</span><span className="text-xs">{period}</span><span className={cn('w-fit rounded-full border px-2 py-0.5 text-xs font-medium', statusTone(event.status))}>{STATUS_LABELS[event.status] ?? event.status}</span></button>
                  })}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[680px]">
                  <div className="grid grid-cols-[minmax(240px,1fr)_140px_90px_110px_140px] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                    <span>딜 상품</span><span>상품코드</span><span>딜 횟수</span><span>판매수량</span><span>매출</span>
                  </div>
                  {productRows.map((product) => (
                    <div key={product.key} className="grid grid-cols-[minmax(240px,1fr)_140px_90px_110px_140px] items-center gap-3 border-b px-4 py-3 text-sm">
                      <div className="min-w-0"><b className="block truncate">{product.title}</b><span className="mt-1 block text-xs text-muted-foreground">최근 행사 종료 {product.latestEndsOn}</span></div>
                      <span className="truncate text-xs text-muted-foreground">{product.productCode || '-'}</span>
                      <span>{product.dealCount}회</span>
                      <b>{product.soldQuantity.toLocaleString('ko-KR')}개</b>
                      <b>{won(product.salesAmount)}</b>
                    </div>
                  ))}
                  {!productRows.length ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">등록된 딜 상품이 없습니다.</p> : null}
                </div>
              </div>
            )}
          </div>

          <aside className="border-t bg-muted/10 p-4 xl:border-l xl:border-t-0">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setDealStage('registered'); setView('list') }} className="rounded-md border bg-background p-3 text-left hover:bg-muted/50">
                <span className="text-xs font-medium text-muted-foreground">등록한 딜</span>
                <b className="mt-1 block text-xl text-blue-700">{visibleRegisteredDeals.length}</b>
              </button>
              <button type="button" onClick={() => { setDealStage('planned'); setView('list') }} className="rounded-md border bg-background p-3 text-left hover:bg-muted/50">
                <span className="text-xs font-medium text-muted-foreground">선정·플랜</span>
                <b className="mt-1 block text-xl text-violet-700">{visiblePlannedDeals.length}</b>
              </button>
            </div>

            <div className="mt-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4" />상시딜</h2>
              <div className="mt-3 divide-y rounded-md border bg-background">
                {standingDeals.slice(0, 6).map((event) => (
                  <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className="block w-full px-3 py-2.5 text-left hover:bg-muted/50">
                    <span className={cn('mb-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', statusTone(event.status))}>
                      {STATUS_LABELS[event.status] ?? event.status}
                    </span>
                    <b className="block truncate text-sm">{event.title}</b>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{event.productCode || '상품코드 없음'}</p>
                  </button>
                ))}
                {!standingDeals.length ? <p className="px-3 py-5 text-sm text-muted-foreground">등록된 상시딜이 없습니다.</p> : null}
              </div>
            </div>

            <div className="mt-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><CircleAlert className="h-4 w-4" />후속 작업</h2>
            <div className="mt-3 divide-y border-y">
              {todos.slice(0, 5).map((event) => <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className="block w-full py-3 text-left hover:bg-muted/50"><b className="text-sm">{event.status === 'submitted' ? '선정 결과 확인' : '할인·배송 조건 설정'}</b><p className="mt-1 truncate text-xs text-muted-foreground">{event.title}</p></button>)}
              {!todos.length && <p className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" />남은 작업이 없습니다.</p>}
            </div>
            {todos.length > 5 && <button type="button" onClick={() => setView('list')} className="mt-3 text-xs font-medium text-muted-foreground hover:text-foreground">전체 {todos.length}건 보기</button>}
            </div>
            {warningEvents.length ? <div className="mt-5"><h3 className="flex items-center gap-2 text-sm font-semibold text-red-700"><TriangleAlert className="h-4 w-4" />주의 필요</h3><div className="mt-2 divide-y border-y">{warningEvents.slice(0, 3).map((event) => <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className="block w-full py-2.5 text-left"><b className="block truncate text-xs">{event.title}</b><p className="mt-1 truncate text-xs text-red-700">{warnings[event.id][0]}</p></button>)}</div></div> : null}
            <div className="mt-5 flex items-center gap-1 text-xs text-muted-foreground"><i className="size-2 rounded-full bg-emerald-500" />행사 기간</div>
          </aside>
        </div>
      </section>

      {selected ? <EventDetail event={selected} warnings={warnings[selected.id] || []} onClose={() => setSelectedId(null)} /> : null}
      {addOpen ? <AddEventModal onClose={() => setAddOpen(false)} /> : null}
    </>
  )
}

function EventDetail({ event, warnings, onClose }: { event: DealCalendarItem; warnings: string[]; onClose: () => void }) {
  const completedTasks = event.checklist.filter((item) => item.completed).length
  return (
    <div className="fixed inset-0 z-50 bg-black/30" onMouseDown={onClose}>
      <aside className="ml-auto flex h-full w-full max-w-md flex-col bg-background shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b p-5">
          <div className="min-w-0"><div className="text-xs text-muted-foreground">{TYPE_LABELS[event.dealType] ?? event.dealType}</div><h2 className="mt-2 text-lg font-semibold">{event.title}</h2></div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} title="닫기"><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {warnings.length ? <section className="rounded-md border border-red-200 bg-red-50 p-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-red-800"><TriangleAlert className="h-4 w-4" />주의가 필요합니다</h3><ul className="mt-2 space-y-1 text-xs text-red-700">{warnings.map((warning) => <li key={warning}>· {warning}</li>)}</ul></section> : null}
          <section className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Detail label="상태" value={STATUS_LABELS[event.status] ?? event.status} />
            <Detail label="딜 분류" value={TYPE_LABELS[event.dealType] ?? event.dealType} />
            <Detail label="행사 기간" value={`${event.startsOn} ~ ${event.endsOn}`} wide />
            <Detail label="상품코드" value={event.productCode || '-'} />
            <Detail label="딜 판매가" value={won(event.dealPrice)} />
            {event.dealType === 'ad_campaign' ? <><Detail label="캠페인" value={event.campaignName || '-'} /><Detail label="일 예산" value={won(event.dailyBudget)} /><Detail label="검색 입찰가" value={won(event.searchBid)} /><Detail label="추천 입찰가" value={won(event.recommendationBid)} /></> : event.platform === '10x10' ? <><Detail label="최소 할인" value={event.minimumDiscountRate == null ? '-' : `${event.minimumDiscountRate}%`} /><Detail label="신청 상품" value={event.appliedProductCount == null ? '-' : `${event.appliedProductCount}개`} /><Detail label="할인코드" value={event.discountCode || '-'} /><Detail label="프로모션 ID" value={event.externalPromotionId || '-'} /></> : <><Detail label="원가" value={won(event.unitCost)} /><Detail label="배송비" value={won(event.shippingCost)} /><Detail label="재고" value={`${event.stock}개`} /><Detail label="일 출고" value={`${event.dailyCapacity}개`} /></>}
          </section>
          {event.options ? <Detail label="옵션" value={event.options} /> : null}
          {event.notes ? <Detail label="메모" value={event.notes} /> : null}
          <form action={updateDealPerformanceAction} className="rounded-md border p-3">
            <input type="hidden" name="id" value={event.id} />
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">판매 성과</h3><span className="text-xs text-muted-foreground">예상 매출 {won(eventSales(event))}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">판매수량</span><Input name="soldQuantity" type="number" min="0" defaultValue={event.soldQuantity} className="h-9" /></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">실제 매출액</span><Input name="salesAmount" type="number" min="0" defaultValue={event.salesAmount || ''} placeholder="미입력 시 판매가×수량" className="h-9" /></label>
            </div>
            <div className="mt-3 flex justify-end"><Button type="submit" size="sm">성과 저장</Button></div>
          </form>
          <section>
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">준비 체크리스트</h3><span className="text-xs text-muted-foreground">{completedTasks}/{event.checklist.length} 완료</span></div>
            <div className="mt-2 divide-y rounded-md border">
              {event.checklist.map((task) => <form key={task.key} action={updateDealChecklistAction} className="flex items-center gap-2 px-3 py-2.5">
                <input type="hidden" name="id" value={event.id} />
                <input type="hidden" name="taskKey" value={task.key} />
                <input type="hidden" name="completed" value={String(!task.completed)} />
                <input type="checkbox" checked={task.completed} onChange={(changeEvent) => changeEvent.currentTarget.form?.requestSubmit()} className="h-4 w-4" />
                <span className={cn('text-sm', task.completed && 'text-muted-foreground line-through')}>{task.label}</span>
              </form>)}
            </div>
          </section>
        </div>
        <form action={updateDealStatusAction} className="flex items-end gap-2 border-t p-5">
          <input type="hidden" name="id" value={event.id} />
          <label className="min-w-0 flex-1 space-y-1"><span className="text-xs font-medium text-muted-foreground">상태</span><select name="status" defaultValue={event.status} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <Button type="submit" className="h-9">저장</Button>
        </form>
      </aside>
    </div>
  )
}

function AddEventModal({ onClose }: { onClose: () => void }) {
  const [dealType, setDealType] = useState('today')

  async function createEvent(formData: FormData) {
    await createDealEventAction(formData)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onMouseDown={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md bg-background shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4"><h2 className="font-semibold">새 일정 추가</h2><Button type="button" variant="ghost" size="icon" onClick={onClose} title="닫기"><X className="h-4 w-4" /></Button></div>
        <form action={createEvent} className="space-y-3 p-5">
          <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">구분</span><select name="dealType" value={dealType} onChange={(event) => setDealType(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm">{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">상태</span><select name="status" defaultValue="registered" className="h-9 w-full rounded-md border bg-background px-3 text-sm">{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">일정 또는 상품명</span><Input required name="title" /></label>
          <div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">상품코드</span><Input name="productCode" /></label><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">딜 판매가</span><Input name="dealPrice" type="number" /></label></div>
          <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">상품 옵션</span><Input name="options" placeholder="옵션이 여러 개면 쉼표로 구분" /></label>
          {dealType === 'ad_campaign' ? <div className="space-y-3 rounded-md border p-3"><label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">캠페인명</span><Input name="campaignName" /></label><div className="grid grid-cols-3 gap-3"><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">일 예산</span><Input name="dailyBudget" type="number" min="0" /></label><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">검색 입찰가</span><Input name="searchBid" type="number" min="0" /></label><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">추천 입찰가</span><Input name="recommendationBid" type="number" min="0" /></label></div></div> : null}
          <div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">시작일</span><Input required name="startsOn" type="date" /></label><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">종료일</span><Input required name="endsOn" type="date" /></label></div>
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={onClose}>취소</Button><Button type="submit">추가</Button></div>
        </form>
      </div>
    </div>
  )
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={cn(wide && 'col-span-2')}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap font-medium">{value}</p></div>
}
