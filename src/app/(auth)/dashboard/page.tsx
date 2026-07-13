import { eq, and, gte, lt, sql, desc, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { orderMemos, orders, products } from '@/lib/db/schema'
import { ShoppingCart, Calendar, Package, Wallet, TrendingUp, PackageX, Bell, CheckCircle2, Image as ImageIcon } from 'lucide-react'
import Link from 'next/link'
import {
  DailyOrdersChart,
  MonthlyOrdersChart,
  DailySalesChart,
  MonthlySalesChart,
  type DailyPoint,
  type MonthlyPoint,
} from './charts'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { unstable_cache } from 'next/cache'

export const metadata: Metadata = {
  title: '대시보드',
}

export default async function DashboardPage() {
  const user = await getCurrentUser()

  if (!user) {
    return null
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">대시보드</h1>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent workspaceUserId={workspaceUserId} />
      </Suspense>
    </div>
  )
}

const getDashboardData = unstable_cache(async (workspaceUserId: string) => {
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
    recentInspectionMemos,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, workspaceUserId), eq(orders.status, 'new'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, workspaceUserId), gte(orders.orderedAt, monthStart))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.userId, workspaceUserId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, workspaceUserId), eq(orders.isHeld, true))),
    db
      .select({ sum: sql<string>`coalesce(sum(${orders.totalAmount}), 0)::text` })
      .from(orders)
      .where(
        and(
          eq(orders.userId, workspaceUserId),
          gte(orders.orderedAt, dayStart),
          lt(orders.orderedAt, dayEnd),
        ),
      ),
    db
      .select({ sum: sql<string>`coalesce(sum(${orders.totalAmount}), 0)::text` })
      .from(orders)
      .where(and(eq(orders.userId, workspaceUserId), gte(orders.orderedAt, monthStart))),
    db
      .select({
        d: sql<string>`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${orders.totalAmount}), 0)::text`,
      })
      .from(orders)
      .where(and(eq(orders.userId, workspaceUserId), gte(orders.orderedAt, sevenDaysAgo)))
      .groupBy(sql`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`),
    db
      .select({
        m: sql<string>`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`,
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${orders.totalAmount}), 0)::text`,
      })
      .from(orders)
      .where(and(eq(orders.userId, workspaceUserId), gte(orders.orderedAt, twelveMonthsAgo)))
      .groupBy(sql`to_char(${orders.orderedAt} AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')`),
    db
      .select({
        id: orderMemos.id,
        orderId: orders.id,
        marketplaceId: orders.marketplaceId,
        marketplaceOrderId: orders.marketplaceOrderId,
        internalNo: orders.internalNo,
        recipientName: orders.recipientName,
        content: orderMemos.content,
        attachments: orderMemos.attachments,
        createdAt: orderMemos.createdAt,
      })
      .from(orderMemos)
      .innerJoin(orders, eq(orderMemos.orderId, orders.id))
      .where(
        and(
          eq(orders.userId, workspaceUserId),
          inArray(orderMemos.memoType, ['mobile_return_inspection', 'return_inspection']),
        ),
      )
      .orderBy(desc(orderMemos.createdAt))
      .limit(5),
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

  return {
    currentDay: now.getDate(),
    currentMonth: now.getMonth() + 1,
    dailyData,
    heldOrderCount,
    monthOrderCount,
    monthSales,
    monthlyData,
    newOrderCount,
    productCount,
    recentInspectionMemos,
    todaySales,
  }
}, ['dashboard-data'], { revalidate: 60 })

async function DashboardContent({ workspaceUserId }: { workspaceUserId: string }) {
  const {
    currentDay,
    currentMonth,
    dailyData,
    heldOrderCount,
    monthOrderCount,
    monthSales,
    monthlyData,
    newOrderCount,
    productCount,
    recentInspectionMemos,
    todaySales,
  } = await getDashboardData(workspaceUserId)

  return (
    <div className="space-y-6">
      {recentInspectionMemos.length > 0 && (
        <section className="rounded-lg border border-blue-200 bg-blue-50">
          <div className="flex items-center justify-between border-b border-blue-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-blue-700" />
              <h2 className="text-sm font-semibold text-blue-950">최근 물류 검수 완료</h2>
            </div>
            <Link href="/cs?workstream=marketplace" className="text-xs font-medium text-blue-700 hover:underline">
              CS 작업함
            </Link>
          </div>
          <div className="divide-y divide-blue-100 bg-white/70">
            {recentInspectionMemos.map((memo) => {
              const lines = memo.content.split('\n')
              const resultLine = lines.find((line) => line.includes('검수결과')) ?? lines[0] ?? '검수 완료'
              const attachmentCount = memo.attachments.length
              return (
                <Link
                  key={memo.id}
                  href={`/orders/${memo.orderId}`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-white"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-gray-900">{memo.marketplaceOrderId}</span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">{memo.marketplaceId}</span>
                      {attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                          <ImageIcon className="h-3 w-3" />
                          {attachmentCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-gray-800">{resultLine}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      #{memo.internalNo} · {memo.recipientName} · {new Intl.DateTimeFormat('ko-KR', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(memo.createdAt)}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="신규 주문"
          value={newOrderCount.toLocaleString('ko-KR')}
          hint="발주확인 대기"
          icon={<ShoppingCart className="h-5 w-5 text-blue-500" />}
          href="/orders?status=new"
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
          hint={`${currentMonth}월 누적`}
          icon={<Calendar className="h-5 w-5 text-emerald-500" />}
          href="/analytics"
        />
        <StatCard
          label="당일 판매금액"
          value={`₩${todaySales.toLocaleString('ko-KR')}`}
          hint={`${currentMonth}/${currentDay} 매출`}
          icon={<Wallet className="h-5 w-5 text-amber-500" />}
          href="/analytics"
        />
        <StatCard
          label="당월 판매금액"
          value={`₩${monthSales.toLocaleString('ko-KR')}`}
          hint={`${currentMonth}월 누적 매출`}
          icon={<TrendingUp className="h-5 w-5 text-rose-500" />}
          href="/analytics/sales"
        />
        <StatCard
          label="전체 상품"
          value={productCount.toLocaleString('ko-KR')}
          hint="등록된 상품 수"
          icon={<Package className="h-5 w-5 text-gray-500" />}
          href="/analytics/sales"
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

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-label="대시보드 통계 불러오는 중">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border bg-gray-100" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-72 animate-pulse rounded-lg border bg-gray-100" />
        ))}
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
