import { eq, and, gte, lt, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, products } from '@/lib/db/schema'
import { ShoppingCart, Calendar, Package, Wallet, TrendingUp, PackageX } from 'lucide-react'
import Link from 'next/link'
import {
  DailyOrdersChart,
  MonthlyOrdersChart,
  DailySalesChart,
  MonthlySalesChart,
  type DailyPoint,
  type MonthlyPoint,
} from './charts'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '대시보드',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const now = new Date()
  // 당일 시작/종료 (서버 로컬 기준 — 가능하면 KST 환경)
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  // 당월 시작
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  // 7일 시작 (오늘 포함 7일)
  const sevenDaysAgo = new Date(dayStart)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  // 12개월 시작 (현재 월 포함 12개월)
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const [
    newOrdersResult,
    monthOrdersResult,
    productCountResult,
    heldOrdersResult,
    todaySalesResult,
    monthSalesResult,
    dailyRows,
    monthlyRows,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, user.id), eq(orders.status, 'new'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, user.id), gte(orders.orderedAt, monthStart))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.userId, user.id)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, user.id), eq(orders.isHeld, true))),
    db
      .select({ sum: sql<string>`coalesce(sum(${orders.totalAmount}), 0)::text` })
      .from(orders)
      .where(
        and(
          eq(orders.userId, user.id),
          gte(orders.orderedAt, dayStart),
          lt(orders.orderedAt, dayEnd),
        ),
      ),
    db
      .select({ sum: sql<string>`coalesce(sum(${orders.totalAmount}), 0)::text` })
      .from(orders)
      .where(and(eq(orders.userId, user.id), gte(orders.orderedAt, monthStart))),
    db
      .select({
        d: sql<string>`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${orders.totalAmount}), 0)::text`,
      })
      .from(orders)
      .where(and(eq(orders.userId, user.id), gte(orders.orderedAt, sevenDaysAgo)))
      .groupBy(sql`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`),
    db
      .select({
        m: sql<string>`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${orders.totalAmount}), 0)::text`,
      })
      .from(orders)
      .where(and(eq(orders.userId, user.id), gte(orders.orderedAt, twelveMonthsAgo)))
      .groupBy(sql`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`),
  ])

  const newOrderCount = newOrdersResult[0]?.count ?? 0
  const monthOrderCount = monthOrdersResult[0]?.count ?? 0
  const productCount = productCountResult[0]?.count ?? 0
  const heldOrderCount = heldOrdersResult[0]?.count ?? 0
  const todaySales = Number(todaySalesResult[0]?.sum ?? 0)
  const monthSales = Number(monthSalesResult[0]?.sum ?? 0)

  // 일별: 최근 7일 모든 날짜를 0으로 채우고 SQL 결과 머지
  const dailyMap = new Map(
    dailyRows.map((r) => [r.d, { count: r.count, amount: Number(r.amount) }]),
  )
  const dailyData: DailyPoint[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo)
    d.setDate(sevenDaysAgo.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const entry = dailyMap.get(key)
    dailyData.push({
      date: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count: entry?.count ?? 0,
      amount: entry?.amount ?? 0,
    })
  }

  // 월별: 최근 12개월 채움
  const monthlyMap = new Map(
    monthlyRows.map((r) => [r.m, { count: r.count, amount: Number(r.amount) }]),
  )
  const monthlyData: MonthlyPoint[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(twelveMonthsAgo)
    d.setMonth(twelveMonthsAgo.getMonth() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const entry = monthlyMap.get(key)
    monthlyData.push({
      month: key,
      label: `${d.getMonth() + 1}월`,
      count: entry?.count ?? 0,
      amount: entry?.amount ?? 0,
    })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">대시보드</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="신규 주문"
          value={newOrderCount.toLocaleString('ko-KR')}
          hint="발주확인 대기"
          icon={<ShoppingCart className="h-5 w-5 text-blue-500" />}
        />
        <StatCard
          label="미발송 출고"
          value={heldOrderCount.toLocaleString('ko-KR')}
          hint="송장 발급 후 미출고"
          icon={<PackageX className="h-5 w-5 text-orange-500" />}
          href="/shipping/held"
          highlight={heldOrderCount > 0}
        />
        <StatCard
          label="당월 주문"
          value={monthOrderCount.toLocaleString('ko-KR')}
          hint={`${now.getMonth() + 1}월 누적`}
          icon={<Calendar className="h-5 w-5 text-emerald-500" />}
        />
        <StatCard
          label="당일 판매금액"
          value={`₩${todaySales.toLocaleString('ko-KR')}`}
          hint={`${now.getMonth() + 1}/${now.getDate()} 매출`}
          icon={<Wallet className="h-5 w-5 text-amber-500" />}
        />
        <StatCard
          label="당월 판매금액"
          value={`₩${monthSales.toLocaleString('ko-KR')}`}
          hint={`${now.getMonth() + 1}월 누적 매출`}
          icon={<TrendingUp className="h-5 w-5 text-rose-500" />}
        />
        <StatCard
          label="전체 상품"
          value={productCount.toLocaleString('ko-KR')}
          hint="등록된 상품 수"
          icon={<Package className="h-5 w-5 text-gray-500" />}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="일별 주문 (최근 7일)">
          <DailyOrdersChart data={dailyData} />
        </ChartCard>
        <ChartCard title="월별 주문 (최근 12개월)">
          <MonthlyOrdersChart data={monthlyData} />
        </ChartCard>
        <ChartCard title="일별 매출 (최근 7일)">
          <DailySalesChart data={dailyData} />
        </ChartCard>
        <ChartCard title="월별 매출 (최근 12개월)">
          <MonthlySalesChart data={monthlyData} />
        </ChartCard>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  highlight,
}: {
  label: string
  value: string
  hint: string
  icon: React.ReactNode
  href?: string
  highlight?: boolean
}) {
  const baseClass = 'rounded-lg border bg-white p-4'
  const interactiveClass = href ? ' transition-shadow hover:shadow-md' : ''
  const highlightClass = highlight ? ' border-orange-300 bg-orange-50' : ''
  const className = baseClass + interactiveClass + highlightClass

  const inner = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
      {icon}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    )
  }
  return <div className={className}>{inner}</div>
}

function ChartCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  )
}
