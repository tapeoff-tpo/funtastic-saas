import { redirect } from 'next/navigation'
import { CalendarCheck2, CalendarDays, CheckCircle2, CircleAlert, PackageCheck } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { DEAL_PLATFORM_LABELS, DEAL_STATUS_LABELS, DEAL_TYPE_LABELS, listDealEvents } from '@/lib/operations/deal-calendar'
import { createDealEventAction, updateDealStatusAction } from './actions'
import { DealCalendarGrid, type DealCalendarItem } from './deal-calendar-grid'

export const dynamic = 'force-dynamic'

const won = (value: number | null) => value == null || value === 0 ? '-' : `${value.toLocaleString('ko-KR')}원`

export default async function DealCalendarPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const events = await listDealEvents(await getWorkspaceUserId(user.id))
  const calendarEvents: DealCalendarItem[] = events.map((event) => ({
    id: event.id,
    platform: event.platform,
    dealType: event.dealType,
    title: event.title,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    applicationStartsOn: event.applicationStartsOn,
    applicationEndsOn: event.applicationEndsOn,
    minimumDiscountRate: event.minimumDiscountRate,
    appliedProductCount: event.appliedProductCount,
    discountCode: event.discountCode,
    externalPromotionId: event.externalPromotionId,
    status: event.status,
    notes: event.notes,
  }))
  const tenByTenEvents = events.filter((event) => event.platform === '10x10')
  const todos = events.filter((event) => ['submitted', 'selected'].includes(event.status))

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-1.5 text-base font-semibold sm:gap-2 sm:text-2xl"><CalendarDays className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />광고·딜 캘린더</h1>
        <p className="mt-1 text-sm text-muted-foreground">마켓별 신청 마감과 실제 행사 일정을 한곳에서 관리합니다.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary icon={CalendarCheck2} label="등록 일정" value={events.length} suffix="건" />
        <Summary icon={PackageCheck} label="텐바이텐 신청 상품" value={tenByTenEvents.reduce((sum, event) => sum + (event.appliedProductCount ?? 0), 0)} suffix="개" />
        <Summary icon={CheckCircle2} label="텐바이텐 신청 완료" value={tenByTenEvents.filter((event) => event.status === 'applied').length} suffix="건" />
        <Summary icon={CircleAlert} label="남은 후속 작업" value={todos.length} suffix="건" />
      </section>

      <DealCalendarGrid events={calendarEvents} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">등록된 일정</h2>
            <span className="text-xs text-muted-foreground">총 {events.length}건</span>
          </div>
          {events.map((event) => (
            <article key={event.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={event.platform === '10x10' ? 'rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700' : 'rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800'}>{DEAL_PLATFORM_LABELS[event.platform] ?? event.platform}</span>
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium">{DEAL_TYPE_LABELS[event.dealType] ?? event.dealType}</span>
                    <span className="rounded border px-2 py-1 text-xs">{DEAL_STATUS_LABELS[event.status] ?? event.status}</span>
                  </div>
                  <h3 className="mt-2 font-semibold">{event.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">행사 {event.startsOn} ~ {event.endsOn}</p>
                  {event.applicationStartsOn && event.applicationEndsOn && <p className="mt-1 text-xs text-blue-700">신청 {event.applicationStartsOn} ~ {event.applicationEndsOn}</p>}
                </div>
                {event.platform === '10x10' ? (
                  <div className="grid grid-cols-3 gap-4 text-right text-xs">
                    <Metric label="최소 할인" value={event.minimumDiscountRate == null ? '-' : `${event.minimumDiscountRate}%`} />
                    <Metric label="신청 상품" value={event.appliedProductCount == null ? '-' : `${event.appliedProductCount}개`} />
                    <Metric label="할인코드" value={event.discountCode ?? '-'} />
                  </div>
                ) : <b className="text-blue-700">{won(event.dealPrice)}</b>}
              </div>
              {event.options && <p className="mt-3 text-xs">옵션: {event.options}</p>}
              {event.platform !== '10x10' && <p className="mt-2 text-xs text-muted-foreground">재고 {event.stock} · 일 출고 {event.dailyCapacity} · 원가 {won(event.unitCost)} · 배송비 {won(event.shippingCost)}</p>}
              {event.notes && <p className="mt-2 text-xs text-muted-foreground">{event.notes}</p>}
              <form action={updateDealStatusAction} className="mt-3 flex gap-2">
                <input type="hidden" name="id" value={event.id} />
                <select name="status" defaultValue={event.status} className="h-8 rounded border bg-background px-2 text-xs">
                  {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <button className="rounded bg-slate-900 px-3 text-xs text-white">상태 저장</button>
              </form>
            </article>
          ))}
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="flex items-center gap-2 font-semibold"><CircleAlert className="h-4 w-4" />후속 작업</h2>
            <div className="mt-3 space-y-3">
              {todos.map((event) => <div key={event.id} className="rounded border p-3 text-sm"><b>{event.status === 'submitted' ? '선정 결과 확인' : '할인·배송 조건 설정'}</b><p className="mt-1 text-xs text-muted-foreground">{DEAL_PLATFORM_LABELS[event.platform]} · {event.title}</p></div>)}
              {!todos.length && <p className="flex gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" />남은 후속 작업이 없습니다.</p>}
            </div>
          </section>

          <form action={createDealEventAction} className="space-y-2 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">새 일정 추가</h2>
            <div className="grid grid-cols-2 gap-2">
              <select name="platform" className="w-full rounded border p-2 text-sm">{Object.entries(DEAL_PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <select name="dealType" className="w-full rounded border p-2 text-sm">{Object.entries(DEAL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            </div>
            <input required name="title" placeholder="일정 또는 상품명" className="w-full rounded border p-2 text-sm" />
            <input name="productCode" placeholder="상품코드" className="w-full rounded border p-2 text-sm" />
            <input name="dealPrice" type="number" placeholder="딜 판매가 (프로모션은 생략)" className="w-full rounded border p-2 text-sm" />
            <div className="grid grid-cols-2 gap-2"><input required name="startsOn" type="date" className="rounded border p-2 text-sm" /><input required name="endsOn" type="date" className="rounded border p-2 text-sm" /></div>
            <button className="w-full rounded bg-blue-600 p-2 text-sm font-medium text-white">캘린더에 추가</button>
          </form>
        </aside>
      </div>
    </div>
  )
}

function Summary({ icon: Icon, label, value, suffix }: { icon: typeof CalendarDays; label: string; value: number; suffix: string }) {
  return <div className="flex items-center gap-3 rounded-lg border bg-card p-4"><div className="grid size-9 place-items-center rounded bg-slate-100"><Icon className="h-4 w-4" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 text-xl font-semibold">{value.toLocaleString('ko-KR')}<span className="ml-0.5 text-sm font-normal text-muted-foreground">{suffix}</span></p></div></div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-muted-foreground">{label}</p><p className="mt-1 font-semibold text-foreground">{value}</p></div>
}
