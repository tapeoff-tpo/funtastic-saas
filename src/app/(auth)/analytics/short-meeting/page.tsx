import type { Metadata } from 'next'
import { AlertTriangle, Boxes, ClipboardList, PackageCheck } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getCachedShortMeetingData } from '@/lib/analytics/short-meeting'
import { ShortMeetingTable } from './short-meeting-table'

export const metadata: Metadata = { title: '숏미팅' }

export default async function ShortMeetingPage() {
  const user = await getCurrentUser()
  if (!user) return null
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const data = await getCachedShortMeetingData(workspaceUserId).catch((error) => {
    console.error('short meeting error:', error)
    return null
  })

  if (!data) {
    return <div className="space-y-4"><h1 className="text-xl font-bold">숏미팅</h1><p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">숏미팅 데이터를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p></div>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">숏미팅</h1>
        <p className="text-sm text-muted-foreground">{data.dateLabel} 주문 상품별 출고·재고 현황</p>
      </div>
      {data.sheetStatus === 'unavailable' && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          품절 구글시트를 불러오지 못해 품절 목록 여부를 확인할 수 없습니다. 시트 공유 설정과 연결 상태를 확인해 주세요.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={ClipboardList} label="오늘 출고 상품" value={`${data.summary.productCount.toLocaleString('ko-KR')}종`} />
        <SummaryCard icon={PackageCheck} label="오늘 출고수량" value={`${data.summary.todayOutbound.toLocaleString('ko-KR')}개`} />
        <SummaryCard icon={AlertTriangle} label="출고 후 품절" value={`${data.summary.outOfStockCount.toLocaleString('ko-KR')}종`} tone="danger" />
        <SummaryCard icon={Boxes} label="7일 이내 재고 위험" value={`${data.summary.riskCount.toLocaleString('ko-KR')}종`} tone="warning" />
      </div>
      <ShortMeetingTable rows={data.rows} sheetStatus={data.sheetStatus} />
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, tone = 'default' }: {
  icon: typeof ClipboardList
  label: string
  value: string
  tone?: 'default' | 'warning' | 'danger'
}) {
  const color = tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-muted-foreground'
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className={`size-4 ${color}`} />{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${tone === 'danger' ? 'text-red-600' : ''}`}>{value}</div>
    </div>
  )
}
