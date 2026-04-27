import { eq, and, gte, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { orders, products } from '@/lib/db/schema'
import { ShoppingCart, Calendar, Package } from 'lucide-react'
import {
  DailyOrdersChart,
  MonthlyOrdersChart,
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
  // 당월 시작 (KST). orderedAt 인덱스 활용을 위해 단순 비교.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  // 7일 시작 (오늘 포함 7일)
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const sevenDaysAgo = new Date(dayStart)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
  // 12개월 시작 (현재 월 포함 12개월)
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const [
    newOrdersResult,
    monthOrdersResult,
    productCountResult,
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
      .select({
        d: sql<string>`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(eq(orders.userId, user.id), gte(orders.orderedAt, sevenDaysAgo)))
      .groupBy(sql`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`),
    db
      .select({
        m: sql<string>`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(eq(orders.userId, user.id), gte(orders.orderedAt, twelveMonthsAgo)))
      .groupBy(sql`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`),
  ])

  const newOrderCount = newOrdersResult[0]?.count ?? 0
  const monthOrderCount = monthOrdersResult[0]?.count ?? 0
  const productCount = productCountResult[0]?.count ?? 0

  // 일별: 최근 7일 모든 날짜를 0으로 채우고 SQL 결과 머지
  const dailyMap = new Map(dailyRows.map((r) => [r.d, r.count]))
  const dailyData: DailyPoint[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo)
    d.setDate(sevenDaysAgo.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    dailyData.push({
      date: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count: dailyMap.get(key) ?? 0,
    })
  }

  // 월별: 최근 12개월 채움
  const monthlyMap = new Map(monthlyRows.map((r) => [r.m, r.count]))
  const monthlyData: MonthlyPoint[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(twelveMonthsAgo)
    d.setMonth(twelveMonthsAgo.getMonth() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthlyData.push({
      month: key,
      label: `${d.getMonth() + 1}월`,
      count: monthlyMap.get(key) ?? 0,
    })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">대시보드</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="신규 주문"
          value={newOrderCount}
          hint="발주확인 대기"
          icon={<ShoppingCart className="h-5 w-5 text-blue-500" />}
        />
        <StatCard
          label="당월 주문"
          value={monthOrderCount}
          hint={`${now.getMonth() + 1}월 누적`}
          icon={<Calendar className="h-5 w-5 text-emerald-500" />}
        />
        <StatCard
          label="전체 상품"
          value={productCount}
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
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: number
  hint: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {value.toLocaleString('ko-KR')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        {icon}
      </div>
    </div>
  )
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
