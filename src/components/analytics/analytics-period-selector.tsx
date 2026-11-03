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
    <section className="rounded-xl border bg-card p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 inline-flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-primary" />기간</span>
          {options.map((option) => <Link key={option.key} href={`${path}?range=${option.key}&date=${period.key}`} className={`inline-flex min-h-9 items-center rounded-md border px-3 py-1.5 text-sm font-medium ${period.granularity === option.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>{option.label}</Link>)}
        </div>
        <form action={path} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="range" value="custom" />
          <label className="grid gap-1 text-xs text-muted-foreground">시작일<input aria-label="시작일" name="start" type="date" defaultValue={period.startDate} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" /></label>
          <label className="grid gap-1 text-xs text-muted-foreground">종료일<input aria-label="종료일" name="end" type="date" defaultValue={end} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground" /></label>
          <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">적용</button>
        </form>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">현재 {period.label} · {period.startDate} - {end}</p>
    </section>
  )
}

function previousDay(endDate: string) {
  const date = new Date(`${endDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
