import { redirect } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { listDealEvents } from '@/lib/operations/deal-calendar'
import { DealCalendarGrid, type DealCalendarItem } from './deal-calendar-grid'

export const dynamic = 'force-dynamic'

export default async function DealCalendarPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const events = await listDealEvents(await getWorkspaceUserId(user.id))
  const calendarEvents: DealCalendarItem[] = events.map((event) => ({
    id: event.id,
    platform: event.platform,
    dealType: event.dealType,
    title: event.title,
    productCode: event.productCode,
    options: event.options,
    dealPrice: event.dealPrice,
    unitCost: event.unitCost,
    shippingCost: event.shippingCost,
    stock: event.stock,
    dailyCapacity: event.dailyCapacity,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    applicationStartsOn: event.applicationStartsOn,
    applicationEndsOn: event.applicationEndsOn,
    minimumDiscountRate: event.minimumDiscountRate,
    appliedProductCount: event.appliedProductCount,
    discountCode: event.discountCode,
    externalPromotionId: event.externalPromotionId,
    status: event.status,
    contact: event.contact,
    notes: event.notes,
  }))

  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><CalendarDays className="h-6 w-6" />광고·딜 캘린더</h1>
        <p className="mt-1 text-sm text-muted-foreground">신청 마감과 행사 일정을 월간 흐름으로 확인합니다.</p>
      </header>
      <DealCalendarGrid events={calendarEvents} />
    </div>
  )
}
