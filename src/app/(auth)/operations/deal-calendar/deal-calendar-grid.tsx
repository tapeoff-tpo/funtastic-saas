'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, List, Plus, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { createDealEventAction, updateDealChecklistAction, updateDealStatusAction } from './actions'

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
  status: string
  contact: string | null
  notes: string | null
  checklist: DealChecklistItem[]
}

type CalendarMarker = { event: DealCalendarItem; phase: 'application' | 'event' }
type ViewMode = 'calendar' | 'list'
type PhaseFilter = 'all' | 'application' | 'event'
type DeadlineFilter = 'all' | 'today' | '3days' | '7days' | 'overdue'

const PLATFORM_LABELS: Record<string, string> = { kakao: '카카오', '10x10': '텐바이텐', other: '기타' }
const TYPE_LABELS: Record<string, string> = { today: '오늘의딜', one_plus_one: '1+1톡딜', under_10000: '만원톡딜', promotion: '프로모션' }
const STATUS_LABELS: Record<string, string> = { draft: '작성 중', submitted: '제안 완료', applied: '신청 완료', selected: '선정', setup_complete: '설정 완료', live: '진행 중', ended: '종료', rejected: '미선정' }
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
  if (events.some((event) => event.startsOn.startsWith(current) || event.applicationStartsOn?.startsWith(current))) return current
  return events.map((event) => event.applicationStartsOn ?? event.startsOn).sort()[0]?.slice(0, 7) ?? current
}

function won(value: number | null) {
  return value == null || value === 0 ? '-' : `${value.toLocaleString('ko-KR')}원`
}

function addDays(value: Date, days: number) {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

function eventWarnings(events: DealCalendarItem[]) {
  const warnings: Record<string, string[]> = {}
  const add = (id: string, message: string) => {
    warnings[id] = warnings[id] || []
    if (!warnings[id].includes(message)) warnings[id].push(message)
  }

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.productCode && event.platform !== '10x10') {
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
  const [platform, setPlatform] = useState('all')
  const [phase, setPhase] = useState<PhaseFilter>('all')
  const [deadline, setDeadline] = useState<DeadlineFilter>('all')
  const [view, setView] = useState<ViewMode>('calendar')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const selected = events.find((event) => event.id === selectedId) ?? null
  const [year, month] = monthKey.split('-').map(Number)
  const today = dateKey(new Date())
  const sevenDaysLater = new Date()
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7)
  const deadlineLimit = dateKey(sevenDaysLater)
  const threeDayLimit = addDays(new Date(), 3)
  const todos = events.filter((event) => ['submitted', 'selected'].includes(event.status))
  const closingSoon = events.filter((event) => event.applicationEndsOn && event.applicationEndsOn >= today && event.applicationEndsOn <= deadlineLimit)
  const warnings = useMemo(() => eventWarnings(events), [events])
  const warningEvents = events.filter((event) => warnings[event.id]?.length)

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

  const platformEvents = platform === 'all' ? events : events.filter((event) => event.platform === platform)
  const phaseEvents = phase === 'application'
    ? platformEvents.filter((event) => event.applicationStartsOn && event.applicationEndsOn)
    : platformEvents
  const filteredEvents = phaseEvents.filter((event) => {
    const end = event.applicationEndsOn
    if (deadline === 'all') return true
    if (!end) return false
    if (deadline === 'overdue') return end < today
    if (deadline === 'today') return end === today
    if (deadline === '3days') return end >= today && end <= threeDayLimit
    return end >= today && end <= deadlineLimit
  })
  const periodLabel = phase === 'application' ? '신청 기간' : '행사 기간'

  function changeMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1)
    setMonthKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }

  function markersFor(day: string) {
    const markers: CalendarMarker[] = []
    for (const event of filteredEvents) {
      if (phase !== 'event' && event.applicationStartsOn && event.applicationEndsOn && day >= event.applicationStartsOn && day <= event.applicationEndsOn) markers.push({ event, phase: 'application' })
      if (phase !== 'application' && day >= event.startsOn && day <= event.endsOn) markers.push({ event, phase: 'event' })
    }
    return markers
  }

  return (
    <>
      <section className="overflow-hidden rounded-md border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <b>전체 {events.length}건</b>
            <span className="text-muted-foreground">7일 내 신청 마감 <b className="text-foreground">{closingSoon.length}건</b></span>
            <span className="text-muted-foreground">후속 작업 <b className={cn(todos.length && 'text-amber-700', !todos.length && 'text-foreground')}>{todos.length}건</b></span>
            <span className="text-muted-foreground">주의 필요 <b className={cn(warningEvents.length && 'text-red-700', !warningEvents.length && 'text-foreground')}>{warningEvents.length}건</b></span>
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
                <div className="flex rounded border p-0.5 text-xs">
                  {[['all', '전체'], ['10x10', '텐바이텐'], ['kakao', '카카오']].map(([value, label]) => <button key={value} type="button" onClick={() => setPlatform(value)} className={cn('h-7 px-2.5', platform === value ? 'bg-foreground text-background' : 'hover:bg-muted')}>{label}</button>)}
                </div>
                <select value={deadline} onChange={(event) => setDeadline(event.target.value as DeadlineFilter)} aria-label="신청 마감 필터" className="h-8 rounded border bg-background px-2 text-xs">
                  <option value="all">마감 전체</option>
                  <option value="today">오늘 마감</option>
                  <option value="3days">3일 이내</option>
                  <option value="7days">7일 이내</option>
                  <option value="overdue">마감 지남</option>
                </select>
                <div className="flex rounded border p-0.5 text-xs">
                  {([['all', '전체 기간'], ['application', '신청기간'], ['event', '행사기간']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setPhase(value)} className={cn(
                    'h-7 px-2.5',
                    phase === value && value === 'all' && 'bg-foreground text-background',
                    phase === value && value === 'application' && 'bg-blue-600 text-white',
                    phase === value && value === 'event' && 'bg-emerald-600 text-white',
                    phase !== value && 'hover:bg-muted',
                  )}>{label}</button>)}
                </div>
                <div className="flex rounded border p-0.5">
                  <button type="button" title="캘린더 보기" onClick={() => setView('calendar')} className={cn('grid size-7 place-items-center', view === 'calendar' ? 'bg-foreground text-background' : 'hover:bg-muted')}><CalendarDays className="h-4 w-4" /></button>
                  <button type="button" title="목록 보기" onClick={() => setView('list')} className={cn('grid size-7 place-items-center', view === 'list' ? 'bg-foreground text-background' : 'hover:bg-muted')}><List className="h-4 w-4" /></button>
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
                            {markers.slice(0, 2).map((marker) => <button key={`${marker.event.id}-${marker.phase}`} type="button" onClick={() => setSelectedId(marker.event.id)} className={cn('block w-full truncate rounded-sm border-l-2 bg-muted/50 px-1.5 py-1 text-left text-[10px] font-medium hover:bg-muted', marker.phase === 'application' ? 'border-l-blue-500 text-blue-800' : 'border-l-emerald-500 text-emerald-800')} title={`${marker.phase === 'application' ? '신청 기간' : '행사 기간'} · ${marker.event.title}${warnings[marker.event.id]?.length ? ' · 주의 필요' : ''}`}>{warnings[marker.event.id]?.length ? '! ' : ''}{marker.event.title}</button>)}
                            {markers.length > 2 && <p className="px-1 text-[10px] text-muted-foreground">+{markers.length - 2}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[90px_minmax(220px,1fr)_120px_180px_90px] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground"><span>플랫폼</span><span>일정</span><span>구분</span><span>{periodLabel}</span><span>상태</span></div>
                  {filteredEvents.map((event) => {
                    const period = phase === 'application' && event.applicationStartsOn && event.applicationEndsOn
                      ? `${event.applicationStartsOn} ~ ${event.applicationEndsOn}`
                      : `${event.startsOn} ~ ${event.endsOn}`
                    return <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className="grid w-full grid-cols-[90px_minmax(220px,1fr)_120px_180px_90px] items-center gap-3 border-b px-4 py-3 text-left text-sm hover:bg-muted/50"><span>{PLATFORM_LABELS[event.platform] ?? event.platform}</span><b className="flex min-w-0 items-center gap-1.5">{warnings[event.id]?.length ? <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-red-600" /> : null}<span className="truncate">{event.title}</span></b><span className="text-muted-foreground">{TYPE_LABELS[event.dealType] ?? event.dealType}</span><span className="text-xs">{period}</span><span className="text-xs">{STATUS_LABELS[event.status] ?? event.status}</span></button>
                  })}
                </div>
              </div>
            )}
          </div>

          <aside className="border-t bg-muted/10 p-4 xl:border-l xl:border-t-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><CircleAlert className="h-4 w-4" />후속 작업</h2>
            <div className="mt-3 divide-y border-y">
              {todos.slice(0, 5).map((event) => <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className="block w-full py-3 text-left hover:bg-muted/50"><b className="text-sm">{event.status === 'submitted' ? '선정 결과 확인' : '할인·배송 조건 설정'}</b><p className="mt-1 truncate text-xs text-muted-foreground">{PLATFORM_LABELS[event.platform]} · {event.title}</p></button>)}
              {!todos.length && <p className="flex items-center gap-2 py-5 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" />남은 작업이 없습니다.</p>}
            </div>
            {todos.length > 5 && <button type="button" onClick={() => setView('list')} className="mt-3 text-xs font-medium text-muted-foreground hover:text-foreground">전체 {todos.length}건 보기</button>}
            {warningEvents.length ? <div className="mt-5"><h3 className="flex items-center gap-2 text-sm font-semibold text-red-700"><TriangleAlert className="h-4 w-4" />주의 필요</h3><div className="mt-2 divide-y border-y">{warningEvents.slice(0, 3).map((event) => <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className="block w-full py-2.5 text-left"><b className="block truncate text-xs">{event.title}</b><p className="mt-1 truncate text-xs text-red-700">{warnings[event.id][0]}</p></button>)}</div></div> : null}
            <div className="mt-5 flex items-center gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><i className="size-2 rounded-full bg-blue-500" />신청 기간</span><span className="flex items-center gap-1"><i className="size-2 rounded-full bg-emerald-500" />행사 기간</span></div>
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
          <div className="min-w-0"><div className="flex items-center gap-2 text-xs text-muted-foreground"><span>{PLATFORM_LABELS[event.platform] ?? event.platform}</span><span>·</span><span>{TYPE_LABELS[event.dealType] ?? event.dealType}</span></div><h2 className="mt-2 text-lg font-semibold">{event.title}</h2></div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} title="닫기"><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {warnings.length ? <section className="rounded-md border border-red-200 bg-red-50 p-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-red-800"><TriangleAlert className="h-4 w-4" />주의가 필요합니다</h3><ul className="mt-2 space-y-1 text-xs text-red-700">{warnings.map((warning) => <li key={warning}>· {warning}</li>)}</ul></section> : null}
          <section className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Detail label="행사 기간" value={`${event.startsOn} ~ ${event.endsOn}`} wide />
            {event.applicationStartsOn && event.applicationEndsOn ? <Detail label="신청 기간" value={`${event.applicationStartsOn} ~ ${event.applicationEndsOn}`} wide /> : null}
            <Detail label="상품코드" value={event.productCode || '-'} />
            <Detail label="딜 판매가" value={won(event.dealPrice)} />
            {event.platform === '10x10' ? <><Detail label="최소 할인" value={event.minimumDiscountRate == null ? '-' : `${event.minimumDiscountRate}%`} /><Detail label="신청 상품" value={event.appliedProductCount == null ? '-' : `${event.appliedProductCount}개`} /><Detail label="할인코드" value={event.discountCode || '-'} /><Detail label="프로모션 ID" value={event.externalPromotionId || '-'} /></> : <><Detail label="원가" value={won(event.unitCost)} /><Detail label="배송비" value={won(event.shippingCost)} /><Detail label="재고" value={`${event.stock}개`} /><Detail label="일 출고" value={`${event.dailyCapacity}개`} /></>}
          </section>
          {event.options ? <Detail label="옵션" value={event.options} /> : null}
          {event.notes ? <Detail label="메모" value={event.notes} /> : null}
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
  async function createEvent(formData: FormData) {
    await createDealEventAction(formData)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onMouseDown={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md bg-background shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4"><h2 className="font-semibold">새 일정 추가</h2><Button type="button" variant="ghost" size="icon" onClick={onClose} title="닫기"><X className="h-4 w-4" /></Button></div>
        <form action={createEvent} className="space-y-3 p-5">
          <div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">플랫폼</span><select name="platform" className="h-9 w-full rounded-md border bg-background px-3 text-sm">{Object.entries(PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">구분</span><select name="dealType" className="h-9 w-full rounded-md border bg-background px-3 text-sm">{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">일정 또는 상품명</span><Input required name="title" /></label>
          <div className="grid grid-cols-2 gap-3"><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">상품코드</span><Input name="productCode" /></label><label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">딜 판매가</span><Input name="dealPrice" type="number" /></label></div>
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
