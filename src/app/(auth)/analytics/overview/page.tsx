import type { Metadata } from 'next'
import { BarChart3, CircleDollarSign, PackageCheck, RotateCcw, Sparkles, Truck } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getAnalyticsPeriod, getAvailableAnalyticsMonths, getLatestAnalyticsDate, getSalesAnalytics } from '@/lib/analytics/queries'
import { AnalyticsPeriodSelector } from '@/components/analytics/analytics-period-selector'
import { Card, CardContent } from '@/components/ui/card'

export const metadata: Metadata = { title: '대시보드' }

type PageProps = { searchParams: Promise<{ month?: string; range?: string; date?: string; start?: string; end?: string }> }

const currency = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('ko-KR')
const percent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' })
const compactPercent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 0 })

export default async function AnalyticsOverviewPage({ searchParams }: PageProps) {
  const params = await searchParams
  const user = await getCurrentUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [availableMonths, latestDate] = await Promise.all([getAvailableAnalyticsMonths(workspaceUserId), getLatestAnalyticsDate(workspaceUserId)])
  const period = getAnalyticsPeriod({
    range: params.range,
    date: params.date ?? (params.range === 'month' ? undefined : latestDate ?? undefined),
    month: params.month ?? (params.range === 'month' ? availableMonths[0] : undefined),
    start: params.start,
    end: params.end,
  })
  const data = await getSalesAnalytics(workspaceUserId, period)
  const claimTotal = data.claims.reduce((sum, row) => sum + row.count, 0)
  const salesChange = data.previous.grossSales > 0 ? (data.summary.grossSales - data.previous.grossSales) / data.previous.grossSales : null

  return (
    <div className="space-y-5">
      <header><div className="flex items-center gap-2"><BarChart3 className="size-5 text-primary" /><h1 className="text-2xl font-bold">대시보드</h1></div><p className="mt-1 text-sm text-muted-foreground">기간별 핵심 지표와 바로 확인할 상품 변화를 봅니다.</p></header>

      <AnalyticsPeriodSelector path="/analytics/overview" period={period} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<CircleDollarSign className="size-5 text-emerald-600" />} label="일반 출고 매출" value={currency.format(data.summary.grossSales)} hint={salesChange == null ? '이전 기간 데이터 없음' : `직전 대비 ${percent.format(salesChange)}`} />
        <MetricCard icon={<PackageCheck className="size-5 text-violet-600" />} label="출고 주문" value={`${integer.format(data.summary.orders)}건`} hint={data.previous.orders > 0 ? `직전 ${integer.format(data.previous.orders)}건` : '이전 기간 데이터 없음'} />
        <MetricCard icon={<Truck className="size-5 text-blue-600" />} label="배송비 값 보유" value={coverageText(data.summary.shippingValueCoverage)} hint={`유료 배송비 ${integer.format(data.summary.shippingNonzeroOrders)}건`} />
        <MetricCard icon={<RotateCcw className="size-5 text-rose-600" />} label="클레임" value={`${integer.format(claimTotal)}건`} hint="반품·교환 합계" />
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <SummaryCard icon={<Sparkles className="size-4 text-primary" />} title="채널·상품 하락">
          {data.channelProductDrops.length > 0 ? <ul className="space-y-1">{data.channelProductDrops.slice(0, 8).map((row) => <li key={`${row.marketplace}-${row.sku}`}><strong>{row.marketplace}</strong> · {row.productName} <span className="text-rose-700">{currency.format(row.previousSales - row.currentSales)} 감소</span><span className="ml-1 text-xs text-muted-foreground">({row.sku})</span></li>)}</ul> : '비교 가능한 하락 상품이 없습니다.'}
        </SummaryCard>
        <SummaryCard title="채널·상품 상승">
          {data.channelProductRises.length > 0 ? <ul className="space-y-1">{data.channelProductRises.slice(0, 8).map((row) => <li key={`${row.marketplace}-${row.sku}`}><strong>{row.marketplace}</strong> · {row.productName} <span className="text-emerald-700">{currency.format(row.currentSales - row.previousSales)} 증가</span><span className="ml-1 text-xs text-muted-foreground">({row.sku})</span></li>)}</ul> : '비교 가능한 상승 상품이 없습니다.'}
        </SummaryCard>
      </section>
    </div>
  )
}

function MetricCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) { return <Card><CardContent className="flex min-h-[118px] items-start justify-between pt-4"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>{icon}</CardContent></Card> }
function SummaryCard({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) { return <Card><CardContent className="min-h-[148px] pt-4"><div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div><div className="mt-2 text-sm leading-5 text-muted-foreground">{children}</div></CardContent></Card> }
function coverageText(value: number | null) { return value == null ? '–' : compactPercent.format(value) }
