'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export type DealCalendarItem = {
  id: string
  platform: string
  dealType: string
  title: string
  startsOn: string
  endsOn: string
  applicationStartsOn: string | null
  applicationEndsOn: string | null
  minimumDiscountRate: number | null
  appliedProductCount: number | null
  discountCode: string | null
  externalPromotionId: string | null
  status: string
  notes: string | null
}

type CalendarMarker = { event: DealCalendarItem; phase: 'application' | 'event' }

const PLATFORM_LABELS: Record<string, string> = { kakao: '카카오', '10x10': '텐바이텐', other: '기타' }
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

export function DealCalendarGrid({ events }: { events: DealCalendarItem[] }) {
  const [monthKey, setMonthKey] = useState(() => initialMonth(events))
  const [platform, setPlatform] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(events[0]?.id ?? null)
  const selected = events.find((event) => event.id === selectedId) ?? null
  const [year, month] = monthKey.split('-').map(Number)

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

  const filteredEvents = platform === 'all' ? events : events.filter((event) => event.platform === platform)

  function changeMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1)
    setMonthKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }

  function markersFor(day: string) {
    const markers: CalendarMarker[] = []
    for (const event of filteredEvents) {
      if (event.applicationStartsOn && event.applicationEndsOn && day >= event.applicationStartsOn && day <= event.applicationEndsOn) markers.push({ event, phase: 'application' })
      if (day >= event.startsOn && day <= event.endsOn) markers.push({ event, phase: 'event' })
    }
    return markers
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" aria-label="이전 달" title="이전 달" onClick={() => changeMonth(-1)} className="grid size-8 place-items-center rounded border hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
          <h2 className="min-w-20 text-center text-sm font-semibold sm:min-w-36 sm:text-base">{year}년 {month}월</h2>
          <button type="button" aria-label="다음 달" title="다음 달" onClick={() => changeMonth(1)} className="grid size-8 place-items-center rounded border hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded border p-0.5 text-xs">
            {[['all', '전체'], ['10x10', '텐바이텐'], ['kakao', '카카오']].map(([value, label]) => <button key={value} type="button" onClick={() => setPlatform(value)} className={`h-7 px-2.5 ${platform === value ? 'bg-slate-900 text-white' : 'hover:bg-muted'}`}>{label}</button>)}
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><i className="size-2 rounded-full bg-blue-500" />신청기간</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground"><i className="size-2 rounded-full bg-emerald-500" />행사기간</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-xs text-muted-foreground">{WEEKDAYS.map((weekday) => <div key={weekday} className="py-2">{weekday}</div>)}</div>
          <div className="grid grid-cols-7">
            {days.map((date) => {
              const day = dateKey(date)
              const markers = markersFor(day)
              const inMonth = date.getMonth() === month - 1
              return (
                <div key={day} className={`min-h-28 border-b border-r p-1.5 last:border-r-0 ${inMonth ? 'bg-background' : 'bg-muted/20'}`}>
                  <span className={`text-xs ${inMonth ? 'text-foreground' : 'text-muted-foreground/50'}`}>{date.getDate()}</span>
                  <div className="mt-1 space-y-1">
                    {markers.slice(0, 3).map((marker) => <button key={`${marker.event.id}-${marker.phase}`} type="button" onClick={() => setSelectedId(marker.event.id)} className={`block w-full truncate rounded px-1.5 py-1 text-left text-[10px] font-medium ${marker.phase === 'application' ? 'bg-blue-50 text-blue-800 hover:bg-blue-100' : marker.event.platform === '10x10' ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'bg-amber-50 text-amber-900 hover:bg-amber-100'}`} title={`${marker.phase === 'application' ? '신청' : '행사'} · ${marker.event.title}`}><span className="mr-1 opacity-70">{marker.phase === 'application' ? '신청' : '행사'}</span>{marker.event.title}</button>)}
                    {markers.length > 3 && <p className="px-1 text-[10px] text-muted-foreground">+{markers.length - 3}개 일정</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {selected && <div className="grid gap-3 border-t bg-muted/20 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="rounded bg-background px-2 py-1 text-xs font-medium">{PLATFORM_LABELS[selected.platform] ?? selected.platform}</span><span className="rounded border px-2 py-1 text-xs">{STATUS_LABELS[selected.status] ?? selected.status}</span>{selected.externalPromotionId && <span className="text-xs text-muted-foreground">프로모션 #{selected.externalPromotionId}</span>}</div><h3 className="mt-2 font-semibold">{selected.title}</h3><p className="mt-1 text-xs text-muted-foreground">행사 {selected.startsOn} ~ {selected.endsOn}{selected.applicationStartsOn && ` · 신청 ${selected.applicationStartsOn} ~ ${selected.applicationEndsOn}`}</p></div>{selected.platform === '10x10' && <div className="flex gap-6 text-xs"><Detail label="최소 할인" value={selected.minimumDiscountRate == null ? '-' : `${selected.minimumDiscountRate}%`} /><Detail label="신청 상품" value={selected.appliedProductCount == null ? '-' : `${selected.appliedProductCount}개`} /><Detail label="할인코드" value={selected.discountCode ?? '-'} /></div>}</div>}
    </section>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>
}
