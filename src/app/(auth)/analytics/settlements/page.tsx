import { redirect } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getSettlementCalendar } from '@/lib/analytics/settlement-calendar'
import { SettlementCalendar } from './settlement-calendar'

export const dynamic = 'force-dynamic'

export default async function SettlementCalendarPage({ searchParams }: { searchParams?: Promise<{ month?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const month = (await searchParams)?.month
  const selectedMonth = /^\d{4}-\d{2}$/.test(month ?? '') ? month! : new Date().toISOString().slice(0, 7)
  const rows = await getSettlementCalendar(await getWorkspaceUserId(user.id), selectedMonth)
  return <div className="space-y-4">
    <header><h1 className="flex items-center gap-2 text-2xl font-semibold"><CalendarDays className="h-6 w-6" />정산 캘린더</h1><p className="mt-1 text-sm text-muted-foreground">출고 완료 주문을 기준으로 마켓별 예상 판매대금 정산일과 실제 입금액을 확인합니다.</p></header>
    <SettlementCalendar initialMonth={selectedMonth} rows={rows} />
  </div>
}
