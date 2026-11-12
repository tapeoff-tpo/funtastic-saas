import type { Metadata } from 'next'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getCachedShortMeetingData } from '@/lib/analytics/short-meeting'
import { ShortMeetingTable } from './short-meeting-table'
import { ShortMeetingUpload } from './short-meeting-upload'
import { isMeetingDate, todayInSeoul } from '@/lib/analytics/short-meeting-uploads'

export const metadata: Metadata = { title: '숏미팅' }

export default async function ShortMeetingPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await getCurrentUser()
  if (!user) return null
  const params = await searchParams
  const meetingDate = typeof params.date === 'string' && isMeetingDate(params.date) ? params.date : todayInSeoul()
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const data = await getCachedShortMeetingData(workspaceUserId, meetingDate).catch((error) => {
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
        <p className="text-sm text-muted-foreground">{data.dateLabel} 주문서 기준 상품별 출고·재고 현황</p>
      </div>
      <form className="flex flex-wrap items-end gap-2" action="/analytics/short-meeting">
        <label className="grid gap-1 text-sm">조회 기준일<input type="date" name="date" defaultValue={meetingDate} className="h-9 rounded-md border bg-background px-3" /></label>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm">조회</button>
      </form>
      <ShortMeetingUpload key={meetingDate} defaultDate={meetingDate} />
      <p className="text-sm text-muted-foreground">{data.upload ? `${data.upload.fileName} · 원본 ${data.upload.rowCount.toLocaleString('ko-KR')}행 반영` : '이 기준일에 반영된 주문서가 없습니다.'} · 재고와 발주 현황은 현재 시점 기준입니다.</p>
      {data.sheetStatus === 'unavailable' && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          품절 구글시트를 불러오지 못해 품절 목록 여부를 확인할 수 없습니다. 시트 공유 설정과 연결 상태를 확인해 주세요.
        </p>
      )}
      <ShortMeetingTable rows={data.rows} sheetStatus={data.sheetStatus} />
    </div>
  )
}
