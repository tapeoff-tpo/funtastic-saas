import type { Metadata } from 'next'
import { AlertTriangle, Boxes, ClipboardList, PackageCheck } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { emptyShortMeetingData, getCachedShortMeetingData, type ShortMeetingRow } from '@/lib/analytics/short-meeting'

export const metadata: Metadata = {
  title: '숏미팅',
}

export default async function ShortMeetingPage() {
  const user = await getCurrentUser()
  if (!user) return null
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const data = await getCachedShortMeetingData(workspaceUserId).catch((error) => {
    console.error('short meeting error:', error)
    return emptyShortMeetingData()
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">숏미팅</h1>
        <p className="text-sm text-muted-foreground">{data.dateLabel} 주문 상품별 출고·재고 현황</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={ClipboardList} label="오늘 출고 상품" value={`${data.summary.productCount.toLocaleString('ko-KR')}종`} />
        <SummaryCard icon={PackageCheck} label="오늘 출고수량" value={`${data.summary.todayOutbound.toLocaleString('ko-KR')}개`} />
        <SummaryCard icon={AlertTriangle} label="출고 후 품절" value={`${data.summary.outOfStockCount.toLocaleString('ko-KR')}종`} tone="danger" />
        <SummaryCard icon={Boxes} label="7일 이내 재고 위험" value={`${data.summary.riskCount.toLocaleString('ko-KR')}종`} tone="warning" />
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">오늘 상품별 출고 현황</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            동일 내부상품코드는 합산하며 평균 출고수량은 최근 30일 일평균입니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1600px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>내부상품코드</Th>
                <Th>상품명 / 옵션</Th>
                <Th align="right">당일 출고수량</Th>
                <Th align="right">현재고</Th>
                <Th align="right">출고 후 재고</Th>
                <Th align="right">평균 출고수량</Th>
                <Th align="right">당월 출고수량</Th>
                <Th>품절상태</Th>
                <Th align="right">중국재고</Th>
                <Th>중국출고날짜</Th>
                <Th>중국발주날짜</Th>
                <Th>로케이션</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-12 text-center text-muted-foreground" colSpan={12}>
                    오늘 주문에서 내부상품코드가 확정된 상품이 없습니다.
                  </td>
                </tr>
              ) : data.rows.map((row) => <ShortMeetingTableRow key={row.sku} row={row} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof ClipboardList
  label: string
  value: string
  tone?: 'default' | 'warning' | 'danger'
}) {
  const color = tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-muted-foreground'
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={`size-4 ${color}`} />
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${tone === 'danger' ? 'text-red-600' : ''}`}>{value}</div>
    </div>
  )
}

function ShortMeetingTableRow({ row }: { row: ShortMeetingRow }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-mono text-xs font-medium">{row.sku}</td>
      <td className="max-w-[320px] px-3 py-2">
        <div className="truncate font-medium" title={row.productName}>{row.productName}</div>
        <div className="truncate text-xs text-muted-foreground" title={row.optionName}>{row.optionName}</div>
      </td>
      <Td>{formatQuantity(row.todayOutbound)}</Td>
      <Td>{formatQuantity(row.currentStock)}</Td>
      <Td className={row.stockAfterOutbound <= 0 ? 'font-semibold text-red-600' : ''}>{formatQuantity(row.stockAfterOutbound)}</Td>
      <Td>{formatAverage(row.averageDailyOutbound)}</Td>
      <Td>{formatQuantity(row.monthOutbound)}</Td>
      <td className="px-3 py-2"><StockStatus status={row.stockStatus} /></td>
      <Td muted>{row.chinaStock == null ? '자료 미연결' : formatQuantity(row.chinaStock)}</Td>
      <td className="px-3 py-2 text-muted-foreground">{row.chinaShipmentDate ?? '자료 미연결'}</td>
      <td className="px-3 py-2 text-muted-foreground">{row.chinaOrderDate ?? '자료 미연결'}</td>
      <td className="max-w-[220px] truncate px-3 py-2" title={row.location}>{row.location}</td>
    </tr>
  )
}

function StockStatus({ status }: { status: ShortMeetingRow['stockStatus'] }) {
  if (status === 'out') return <span className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">출고 후 품절</span>
  if (status === 'risk') return <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">7일 이내 위험</span>
  return <span className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">정상</span>
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>
}

function Td({ children, className = '', muted = false }: { children: React.ReactNode; className?: string; muted?: boolean }) {
  return <td className={`px-3 py-2 text-right tabular-nums ${muted ? 'text-muted-foreground' : ''} ${className}`}>{children}</td>
}

function formatQuantity(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}개`
}

function formatAverage(value: number): string {
  return `${(Math.round(value * 10) / 10).toLocaleString('ko-KR')}개/일`
}
