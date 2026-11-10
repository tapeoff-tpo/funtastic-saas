import type { Metadata } from 'next'
import Link from 'next/link'
import { BarChart3, PackageSearch } from 'lucide-react'
import { createClient } from '@/lib/auth/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getAnalyticsPeriod, getAvailableAnalyticsMonths, getLatestAnalyticsDate, getSalesAnalytics } from '@/lib/analytics/queries'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AnalyticsPeriodSelector } from '@/components/analytics/analytics-period-selector'

export const metadata: Metadata = { title: '채널별 매출분석' }

type PageProps = { searchParams: Promise<{ month?: string; range?: string; date?: string; start?: string; end?: string }> }

const currency = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 })
const integer = new Intl.NumberFormat('ko-KR')
const compactPercent = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 0 })

export default async function ChannelAnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [availableMonths, latestDate] = await Promise.all([
    getAvailableAnalyticsMonths(workspaceUserId),
    getLatestAnalyticsDate(workspaceUserId),
  ])
  const period = getAnalyticsPeriod({
    range: params.range,
    date: params.date ?? (params.range === 'month' ? undefined : latestDate ?? undefined),
    month: params.month ?? (params.range === 'month' ? availableMonths[0] : undefined),
    start: params.start,
    end: params.end,
  })
  const data = await getSalesAnalytics(workspaceUserId, period, 'channels')

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2"><BarChart3 className="size-5 text-primary" /><h1 className="text-2xl font-bold">채널별 분석</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">기간별 채널 매출과 상품 원장을 상세하게 확인합니다.</p>
        </div>
        <nav aria-label="매출 분석 보기" className="flex gap-2"><FilterLink href={viewHref('/analytics/channels', period)} active>채널별</FilterLink><FilterLink href={viewHref('/analytics/products', period)}>상품별</FilterLink><FilterLink href="/analytics/clearance">재고정리 운영</FilterLink></nav>
      </header>

      <AnalyticsPeriodSelector path="/analytics/channels" period={period} />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card>
          <CardHeader><CardTitle>전체 채널 매출</CardTitle><CardDescription>배송비 0원은 무료배송과 미수집을 구분할 수 없어 정산 기준으로 보완합니다.</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="pb-3 font-medium">채널</th><th className="pb-3 text-right font-medium">주문</th><th className="pb-3 text-right font-medium">매출</th><th className="pb-3 text-right font-medium">고객 배송비</th><th className="pb-3 text-right font-medium">값 보유</th></tr></thead><tbody>{data.channels.map((row) => <tr key={row.marketplace} className="border-b last:border-0"><td className="py-3 font-medium">{row.marketplace}</td><td className="py-3 text-right tabular-nums">{integer.format(row.orders)}</td><td className="py-3 text-right font-medium tabular-nums">{currency.format(row.sales)}</td><td className="py-3 text-right tabular-nums">{currency.format(row.paidShipping)}</td><td className="py-3 text-right tabular-nums">{coverageText(row.shippingValueCoverage)}</td></tr>)}{data.channels.length === 0 && <EmptyRow colSpan={5} text="선택한 기간의 주문 데이터가 없습니다." />}</tbody></table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-center gap-2"><PackageSearch className="size-4 text-primary" /><CardTitle>채널 점검</CardTitle></div><CardDescription>채널별 운영 우선순위를 빠르게 확인합니다.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {data.channels.slice(0, 5).map((row) => {
              const share = data.summary.grossSales > 0 ? row.sales / data.summary.grossSales : 0
              return <div key={row.marketplace} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><p className="truncate font-medium">{row.marketplace}</p><span className="shrink-0 text-sm font-semibold">{compactPercent.format(share)}</span></div><p className="mt-1 text-xs text-muted-foreground">주문 {integer.format(row.orders)}건 · 배송비 값 {coverageText(row.shippingValueCoverage)}</p></div>
            })}
            {data.channels.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">확인할 채널 데이터가 없습니다.</p>}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader><CardTitle>상품별 매출 상위 30</CardTitle><CardDescription>채널별 흐름을 확인한 뒤, 판매·원가 데이터를 함께 보며 재고 소진과 할인 후보를 고릅니다.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto"><table className="w-full min-w-[780px] text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="pb-3 font-medium">SKU</th><th className="pb-3 font-medium">상품</th><th className="pb-3 text-right font-medium">수량</th><th className="pb-3 text-right font-medium">판매액</th><th className="pb-3 text-right font-medium">원가</th><th className="pb-3 text-right font-medium">배송 원가</th><th className="pb-3 text-right font-medium">상태</th></tr></thead><tbody>{data.products.map((row) => <tr key={row.sku} className="border-b last:border-0"><td className="py-3 font-mono text-xs text-muted-foreground">{row.sku}</td><td className="max-w-[320px] py-3 font-medium">{row.productName}</td><td className="py-3 text-right tabular-nums">{integer.format(row.units)}</td><td className="py-3 text-right font-medium tabular-nums">{currency.format(row.sales)}</td><td className="py-3 text-right tabular-nums">{row.costPrice == null ? '–' : currency.format(row.costPrice)}</td><td className="py-3 text-right tabular-nums">{row.shippingCost == null ? '–' : currency.format(row.shippingCost)}</td><td className="py-3 text-right">{row.costPrice == null ? <Badge variant="outline" className="border-amber-300 text-amber-700">원가 확인</Badge> : <Badge variant="outline" className="border-emerald-300 text-emerald-700">원가 연결</Badge>}</td></tr>)}{data.products.length === 0 && <EmptyRow colSpan={7} text="선택한 기간의 상품 판매 데이터가 없습니다." />}</tbody></table></CardContent>
      </Card>
    </div>
  )
}

function FilterLink({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) { return <Link href={href} className={`inline-flex min-h-9 items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>{children}</Link> }
function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) { return <tr><td colSpan={colSpan} className="py-10 text-center text-muted-foreground">{text}</td></tr> }
function coverageText(value: number | null) { return value == null ? '–' : compactPercent.format(value) }
function viewHref(path: string, period: ReturnType<typeof getAnalyticsPeriod>) { return period.granularity === 'custom' ? `${path}?range=custom&start=${period.startDate}&end=${previousDay(period.endDate)}` : `${path}?range=${period.granularity}&date=${period.key}` }
function previousDay(endDate: string) { const date = new Date(`${endDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10) }
