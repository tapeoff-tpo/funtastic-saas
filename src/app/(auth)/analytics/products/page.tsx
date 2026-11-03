import type { Metadata } from 'next'
import Link from 'next/link'
import { BarChart3, CircleDollarSign, PackageSearch, TrendingDown, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getAnalyticsPeriod, getAvailableAnalyticsMonths, getLatestAnalyticsDate, getSalesAnalytics } from '@/lib/analytics/queries'
import { AnalyticsPeriodSelector } from '@/components/analytics/analytics-period-selector'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata: Metadata = { title: '상품별 매출분석' }

type PageProps = { searchParams: Promise<{ month?: string; range?: string; date?: string; start?: string; end?: string }> }

const currency = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('ko-KR')
const percent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' })

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
  const costKnown = sold.filter((row) => row.productCost != null)
  const grossProfit = costKnown.reduce((sum, row) => sum + (row.grossProfit ?? 0), 0)
  const costKnownSales = costKnown.reduce((sum, row) => sum + row.sales, 0)
  const drops = data.productPerformance.filter((row) => row.previousSales > row.sales).sort((a, b) => (b.previousSales - b.sales) - (a.previousSales - a.sales)).slice(0, 8)
  const rises = data.productPerformance.filter((row) => row.sales > row.previousSales).sort((a, b) => (b.sales - b.previousSales) - (a.sales - a.previousSales)).slice(0, 8)
  const lossMakers = costKnown.filter((row) => (row.grossProfit ?? 0) < 0).sort((a, b) => (a.grossProfit ?? 0) - (b.grossProfit ?? 0)).slice(0, 5)
  const growthProfit = costKnown.filter((row) => row.sales > row.previousSales && (row.grossProfit ?? 0) > 0).sort((a, b) => (b.grossProfit ?? 0) - (a.grossProfit ?? 0)).slice(0, 5)

  return <div className="space-y-5">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><div className="flex items-center gap-2"><PackageSearch className="size-5 text-primary" /><h1 className="text-2xl font-bold">상품별 분석</h1></div><p className="mt-1 text-sm text-muted-foreground">웍스 기준 원가와 실제 출고 매출을 함께 보며 상품별 조치를 결정합니다.</p></div><nav aria-label="매출 분석 보기" className="flex gap-2"><ViewLink href={viewHref('/analytics', period)}>대시보드</ViewLink><ViewLink href={viewHref('/analytics/channels', period)}>채널별</ViewLink><ViewLink href={viewHref('/analytics/products', period)} active>상품별</ViewLink></nav></header>
    <AnalyticsPeriodSelector path="/analytics/products" period={period} />

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<CircleDollarSign className="size-5 text-emerald-600" />} label="상품 매출" value={currency.format(data.summary.grossSales)} hint={`${integer.format(sold.length)}개 판매 SKU`} />
      <Metric icon={<CircleDollarSign className="size-5 text-blue-600" />} label="웍스 기준 상품원가" value={currency.format(costKnown.reduce((sum, row) => sum + (row.productCost ?? 0), 0))} hint={`원가 연결 ${integer.format(costKnown.length)}/${integer.format(sold.length)}개`} />
      <Metric icon={<BarChart3 className="size-5 text-violet-600" />} label="매출총이익" value={currency.format(grossProfit)} hint="수수료·배송비 제외" />
      <Metric icon={<BarChart3 className="size-5 text-amber-600" />} label="원가 연결 매출 비중" value={sold.length === 0 ? '–' : percent.format(costKnownSales / data.summary.grossSales)} hint={`원가 연결 ${integer.format(costKnown.length)}/${integer.format(sold.length)}개 SKU`} />
    </section>

    <section className="grid gap-3 xl:grid-cols-2">
      <InsightCard icon={<TrendingDown className="size-4 text-rose-600" />} title="상품 매출 하락" rows={drops} kind="drop" />
      <InsightCard icon={<TrendingUp className="size-4 text-emerald-600" />} title="상품 매출 상승" rows={rises} kind="rise" />
      <ProfitInsightCard icon={<TrendingDown className="size-4 text-rose-600" />} title="상품원가가 매출을 넘는 항목" rows={lossMakers} tone="risk" />
      <ProfitInsightCard icon={<TrendingUp className="size-4 text-emerald-600" />} title="상승 중인 이익 기여 상품" rows={growthProfit} tone="growth" />
    </section>

    <Card><CardHeader><CardTitle>상품별 손익·증감</CardTitle><p className="text-sm text-muted-foreground">매출총이익은 판매액에서 웍스 기준 상품원가(출고수량×원가)만 차감한 값입니다. 채널 수수료·포장·배송비는 아직 포함하지 않습니다.</p></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[1120px] text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="pb-3 font-medium">SKU</th><th className="pb-3 font-medium">상품</th><th className="pb-3 text-right font-medium">수량</th><th className="pb-3 text-right font-medium">매출</th><th className="pb-3 text-right font-medium">직전 대비</th><th className="pb-3 text-right font-medium">웍스 원가</th><th className="pb-3 text-right font-medium">상품원가</th><th className="pb-3 text-right font-medium">매출총이익</th></tr></thead><tbody>{data.productPerformance.map((row) => { const change = row.previousSales > 0 ? (row.sales - row.previousSales) / row.previousSales : null; return <tr key={row.sku} className="border-b last:border-0"><td className="py-3 font-mono text-xs text-muted-foreground">{row.sku}</td><td className="max-w-[300px] py-3 font-medium">{row.productName}</td><td className="py-3 text-right tabular-nums">{integer.format(row.units)}</td><td className="py-3 text-right font-medium tabular-nums">{currency.format(row.sales)}</td><td className={`py-3 text-right tabular-nums ${change == null ? 'text-muted-foreground' : change < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{change == null ? (row.sales > 0 ? '신규' : '–') : percent.format(change)}</td><td className="py-3 text-right tabular-nums">{row.costPrice == null ? '미연결' : currency.format(row.costPrice)}</td><td className="py-3 text-right tabular-nums">{row.productCost == null ? '–' : currency.format(row.productCost)}</td><td className="py-3 text-right font-medium tabular-nums">{row.grossProfit == null ? '–' : currency.format(row.grossProfit)}</td></tr> })}{data.productPerformance.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">선택한 기간의 상품 판매 데이터가 없습니다.</td></tr>}</tbody></table></CardContent></Card>
  </div>
}

function Metric({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) { return <Card><CardContent className="flex min-h-[118px] items-start justify-between pt-4"><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>{icon}</CardContent></Card> }
function InsightCard({ icon, title, rows, kind }: { icon: React.ReactNode; title: string; rows: Array<{ sku: string; productName: string; sales: number; previousSales: number }>; kind: 'drop' | 'rise' }) { return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">{icon}{title}</CardTitle></CardHeader><CardContent>{rows.length ? <ul className="space-y-2 text-sm">{rows.map((row) => { const amount = kind === 'drop' ? row.previousSales - row.sales : row.sales - row.previousSales; return <li key={row.sku} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate"><strong>{row.productName}</strong> <span className="font-mono text-xs text-muted-foreground">{row.sku}</span></span><span className={`shrink-0 font-medium ${kind === 'drop' ? 'text-rose-700' : 'text-emerald-700'}`}>{currency.format(amount)} {kind === 'drop' ? '감소' : '증가'}</span></li> })}</ul> : <p className="py-3 text-sm text-muted-foreground">비교 가능한 상품이 없습니다.</p>}</CardContent></Card> }
function ProfitInsightCard({ icon, title, rows, tone }: { icon: React.ReactNode; title: string; rows: Array<{ sku: string; productName: string; grossProfit: number | null }>; tone: 'risk' | 'growth' }) { return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base">{icon}{title}</CardTitle></CardHeader><CardContent>{rows.length ? <ul className="space-y-2 text-sm">{rows.map((row) => <li key={row.sku} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate"><strong>{row.productName}</strong> <span className="font-mono text-xs text-muted-foreground">{row.sku}</span></span><span className={`shrink-0 font-medium ${tone === 'risk' ? 'text-rose-700' : 'text-emerald-700'}`}>{currency.format(row.grossProfit ?? 0)}</span></li>)}</ul> : <p className="py-3 text-sm text-muted-foreground">해당 항목이 없습니다.</p>}</CardContent></Card> }
function ViewLink({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) { return <Link href={href} className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>{children}</Link> }
function viewHref(path: string, period: ReturnType<typeof getAnalyticsPeriod>) { return period.granularity === 'custom' ? `${path}?range=custom&start=${period.startDate}&end=${previousDay(period.endDate)}` : `${path}?range=${period.granularity}&date=${period.key}` }
function previousDay(endDate: string) { const date = new Date(`${endDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10) }
