import type { Metadata } from 'next'
import Link from 'next/link'
import { BarChart3, CircleDollarSign, PackageSearch } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getAnalyticsPeriod, getAvailableAnalyticsMonths, getLatestAnalyticsDate, getSalesAnalytics } from '@/lib/analytics/queries'
import { AnalyticsPeriodSelector } from '@/components/analytics/analytics-period-selector'
import { Card, CardContent } from '@/components/ui/card'
import { ProductPerformanceTable } from './product-performance-table'

export const metadata: Metadata = { title: '상품별 매출분석' }

type PageProps = { searchParams: Promise<{ month?: string; range?: string; date?: string; start?: string; end?: string }> }

const currency = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('ko-KR')
const percent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1 })

export default async function ProductAnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [availableMonths, latestDate] = await Promise.all([getAvailableAnalyticsMonths(workspaceUserId), getLatestAnalyticsDate(workspaceUserId)])
  const period = getAnalyticsPeriod({ range: params.range, date: params.date ?? (params.range === 'month' ? undefined : latestDate ?? undefined), month: params.month ?? (params.range === 'month' ? availableMonths[0] : undefined), start: params.start, end: params.end })
  const data = await getSalesAnalytics(workspaceUserId, period)
  const sold = data.productPerformance.filter((row) => row.sales > 0)
  const costKnown = sold.filter((row) => row.costPrice != null && row.costPrice > 0 && row.productCost != null)
  const grossProfit = costKnown.reduce((sum, row) => sum + (row.grossProfit ?? 0), 0)
  const costKnownSales = costKnown.reduce((sum, row) => sum + row.sales, 0)

  return <div className="space-y-5">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><div className="flex items-center gap-2"><PackageSearch className="size-5 text-primary" /><h1 className="text-2xl font-bold">상품별 분석</h1></div><p className="mt-1 text-sm text-muted-foreground">웍스 기준 원가와 실제 출고 매출을 함께 보며 상품별 조치를 결정합니다.</p></div><nav aria-label="매출 분석 보기" className="flex gap-2"><ViewLink href={viewHref('/analytics/channels', period)}>채널별</ViewLink><ViewLink href={viewHref('/analytics/products', period)} active>상품별</ViewLink><ViewLink href="/analytics/clearance">재고정리 운영</ViewLink></nav></header>
    <AnalyticsPeriodSelector path="/analytics/products" period={period} />

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<CircleDollarSign className="size-5 text-emerald-600" />} label="상품 매출" value={currency.format(data.summary.grossSales)} hint={`${integer.format(sold.length)}개 판매 SKU`} />
      <Metric icon={<CircleDollarSign className="size-5 text-blue-600" />} label="웍스 기준 상품원가" value={currency.format(costKnown.reduce((sum, row) => sum + (row.productCost ?? 0), 0))} hint={`원가 연결 ${integer.format(costKnown.length)}/${integer.format(sold.length)}개`} />
      <Metric icon={<BarChart3 className="size-5 text-violet-600" />} label="매출총이익" value={currency.format(grossProfit)} hint="수수료·배송비 제외" />
      <Metric icon={<BarChart3 className="size-5 text-amber-600" />} label="원가 연결 매출 비중" value={sold.length === 0 ? '–' : percent.format(costKnownSales / data.summary.grossSales)} hint={`원가 연결 ${integer.format(costKnown.length)}/${integer.format(sold.length)}개 SKU`} />
    </section>

    <ProductPerformanceTable rows={data.productPerformance} />
  </div>
}

function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) { return <Card><CardContent className="flex min-h-[118px] items-start justify-between pt-4"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>{icon}</CardContent></Card> }
function ViewLink({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) { return <Link href={href} className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>{children}</Link> }
function viewHref(path: string, period: ReturnType<typeof getAnalyticsPeriod>) { return period.granularity === 'custom' ? `${path}?range=custom&start=${period.startDate}&end=${previousDay(period.endDate)}` : `${path}?range=${period.granularity}&date=${period.key}` }
function previousDay(endDate: string) { const date = new Date(`${endDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10) }
