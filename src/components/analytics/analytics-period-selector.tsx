import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import type { AnalyticsGranularity, AnalyticsPeriod } from '@/lib/analytics/queries'

const options: Array<{ key: Exclude<AnalyticsGranularity, 'custom'>; label: string }> = [
  { key: 'day', label: '일' },
  { key: 'week', label: '주' },
  { key: 'month', label: '월' },
  { key: 'quarter', label: '분기' },
  { key: 'year', label: '년' },
]

export function AnalyticsPeriodSelector({ path, period }: { path: string; period: AnalyticsPeriod }) {
  const end = previousDay(period.endDate)

  return (
    <section className="rounded-xl border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2 overflow-x-auto pb-px">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-semibold"><CalendarDays className="size-4 text-primary" />기간</span>
          {options.map((option) => <Link key={option.key} href={`${path}?range=${option.key}&date=${period.key}`} className={`inline-flex h-8 items-center rounded-md border px-2.5 text-sm font-medium ${period.granularity === option.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>{option.label}</Link>)}
        </div>
        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
        <form action={path} className="flex shrink-0 items-center gap-1.5">
          <input type="hidden" name="range" value="custom" />
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><span className="hidden lg:inline">시작</span><input aria-label="시작일" name="start" type="date" defaultValue={period.startDate} className="h-8 w-[122px] rounded-md border bg-background px-1.5 text-sm text-foreground" /></label>
          <span className="text-muted-foreground" aria-hidden>~</span>
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><span className="hidden lg:inline">종료</span><input aria-label="종료일" name="end" type="date" defaultValue={end} className="h-8 w-[122px] rounded-md border bg-background px-1.5 text-sm text-foreground" /></label>
          <button type="submit" className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">적용</button>
        </form>
        <p className="ml-auto hidden shrink-0 text-xs text-muted-foreground 2xl:block">현재 {period.label}</p>
      </div>
    </section>
  )
}

function previousDay(endDate: string) {
  const date = new Date(`${endDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
