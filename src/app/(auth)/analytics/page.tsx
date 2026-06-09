import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getActualShippingCostRecentImports } from '@/lib/shipping/actual-costs'
import {
  emptyOrderProfitAnalysisData,
  emptySalesDashboardData,
  getOrderProfitAnalysisData,
  getSalesDashboardData,
  type OrderProfitAnalysisData,
  type OrderProfitRow,
  type SalesComparisonData,
  type MarketplaceSalesRow,
} from '@/lib/analytics/sales-dashboard'
import { ActualShippingCostUpload } from './actual-shipping-cost-upload'

export const metadata: Metadata = {
  title: '매출분석',
}

const carrierLabels: Record<string, string> = {
  CJGLS: 'CJ대한통운',
  KDEXP: '경동택배',
  DAESIN: '대신택배',
}

type AnalyticsTab = 'dashboard' | 'orders' | 'missing' | 'uploads'

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; page?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const params = await searchParams
  const tab = parseTab(params?.tab)
  const page = Math.max(1, Number.parseInt(params?.page ?? '1', 10) || 1)
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const dashboard = await getSalesDashboardData(workspaceUserId).catch((error) => {
    console.error('sales analytics dashboard error:', error)
    return emptySalesDashboardData()
  })
  const profitData = tab === 'orders' || tab === 'missing'
    ? await getOrderProfitAnalysisData(workspaceUserId, {
      page,
      missingOnly: tab === 'missing',
    }).catch((error) => {
      console.error('order profit analysis error:', error)
      return emptyOrderProfitAnalysisData({ page, missingOnly: tab === 'missing' })
    })
    : null
  const recent = tab === 'uploads'
    ? await getActualShippingCostRecentImports(workspaceUserId).catch((error) => {
      console.error('actual shipping cost recent import error:', error)
      return []
    })
    : []

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">매출분석</h1>
          <p className="text-sm text-muted-foreground">
            {dashboard.currentMonthLabel} 기준 매출과 이익을 실시간으로 계산합니다.
          </p>
        </div>
        <div className="flex w-fit flex-wrap rounded-lg border bg-background p-1 text-sm">
          <TabLink href="/analytics" active={tab === 'dashboard'}>대시보드</TabLink>
          <TabLink href="/analytics?tab=orders" active={tab === 'orders'}>주문별 손익</TabLink>
          <TabLink href="/analytics?tab=missing" active={tab === 'missing'}>계산 누락</TabLink>
          <TabLink href="/analytics?tab=uploads" active={tab === 'uploads'}>업로드</TabLink>
        </div>
      </div>

      {tab === 'uploads' ? (
        <UploadPanel recent={recent} />
      ) : tab === 'orders' || tab === 'missing' ? (
        <OrderProfitPanel data={profitData!} />
      ) : (
        <DashboardPanel
          rows={dashboard.rows}
          totals={dashboard.totals}
          cards={dashboard.cards}
          comparison={dashboard.comparison}
        />
      )}
    </div>
  )
}

function parseTab(value: string | undefined): AnalyticsTab {
  if (value === 'orders' || value === 'missing' || value === 'uploads') return value
  return 'dashboard'
}

function DashboardPanel({
  cards,
  comparison,
  rows,
  totals,
}: {
  cards: Awaited<ReturnType<typeof getSalesDashboardData>>['cards']
  comparison: SalesComparisonData
  rows: MarketplaceSalesRow[]
  totals: MarketplaceSalesRow
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <div key={card.key} className="rounded-lg border bg-card p-4">
            <div className="text-xs font-medium text-muted-foreground">{card.label}</div>
            <div className="mt-2 text-2xl font-bold tabular-nums">
              {card.suffix === '%' ? formatPercent(card.value) : formatWon(card.value)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{card.subLabel}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold">직전 3개월 매출 비교</h2>
            <div className="text-sm text-muted-foreground">
              현재 동기간 {formatWon(comparison.currentSamePeriodSales)}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>구분</Th>
                <Th align="right">매출총금액</Th>
                <Th align="right">현재와 동기간 매출금액</Th>
                <Th align="right">현재 동기간 대비</Th>
                <Th align="right">증감률</Th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={5}>
                    비교할 이전 매출 자료가 없습니다.
                  </td>
                </tr>
              ) : (
                comparison.rows.map((row) => (
                  <tr key={row.monthLabel} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.monthLabel}</td>
                    <Td>{formatWon(row.totalSales)}</Td>
                    <Td>{formatWon(row.samePeriodSales)}</Td>
                    <Td className={row.differenceFromCurrent < 0 ? 'text-red-600' : 'text-emerald-700'}>
                      {formatWon(row.differenceFromCurrent)}
                    </Td>
                    <Td>{row.changeRate == null ? '-' : formatPercent(row.changeRate)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">쇼핑몰별 매출/이익</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>쇼핑몰</Th>
                <Th align="right">쇼핑몰별 매출</Th>
                <Th align="right">쇼핑몰별 수수료</Th>
                <Th align="right">상품원가</Th>
                <Th align="right">결제배송비</Th>
                <Th align="right">실제배송비</Th>
                <Th align="right">배송차익</Th>
                <Th align="right">박스비</Th>
                <Th align="right">최종 이익금</Th>
                <Th align="right">이익률</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={10}>
                    당월 매출 자료가 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((row) => <SalesRow key={row.marketplaceId} row={row} />)
              )}
              {rows.length > 0 ? <SalesRow row={totals} total /> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function OrderProfitPanel({ data }: { data: OrderProfitAnalysisData }) {
  const completeRate = data.summary.totalOrders > 0
    ? (data.summary.completeOrders / data.summary.totalOrders) * 100
    : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatusSummaryCard
          label="전체 주문"
          value={data.summary.totalOrders}
          subLabel={`${data.currentMonthLabel} 주문 기준`}
        />
        <StatusSummaryCard
          label="기초데이터 완료"
          value={data.summary.completeOrders}
          subLabel={`완료율 ${formatPlainPercent(completeRate)}`}
          tone="complete"
        />
        <StatusSummaryCard
          label="계산 확인 필요"
          value={data.summary.incompleteOrders}
          subLabel="한 항목 이상 확인 필요"
          tone="warning"
        />
        <StatusSummaryCard
          label="수수료 누락"
          value={data.summary.missingFeeOrders}
          subLabel="연결 계정 수수료 설정"
        />
        <StatusSummaryCard
          label="상품원가 누락"
          value={data.summary.missingProductCostOrders}
          subLabel="내부상품코드 또는 원가"
        />
        <StatusSummaryCard
          label="배송·박스 누락"
          value={data.summary.missingActualShippingOrders + data.summary.missingPackagingOrders}
          subLabel={`배송비 ${data.summary.missingActualShippingOrders.toLocaleString('ko-KR')} · 박스 ${data.summary.missingPackagingOrders.toLocaleString('ko-KR')}`}
        />
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex flex-col gap-1 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">
              {data.missingOnly ? '계산 누락 주문' : '주문별 손익'}
            </h2>
            <p className="text-xs text-muted-foreground">
              최종 이익금 = 매출 - 수수료 - 상품원가 + 결제배송비 - 실제배송비 - 박스비
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            누락 항목과 박스비는 0원으로 임시 계산됩니다.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1600px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>주문</Th>
                <Th>쇼핑몰</Th>
                <Th>확정상품 / 내부상품코드</Th>
                <Th>계산 상태</Th>
                <Th align="right">매출</Th>
                <Th align="right">수수료</Th>
                <Th align="right">상품원가</Th>
                <Th align="right">결제배송비</Th>
                <Th align="right">실제배송비</Th>
                <Th align="right">박스비</Th>
                <Th align="right">최종 이익금</Th>
                <Th align="right">이익률</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-10 text-center text-muted-foreground" colSpan={12}>
                    {data.missingOnly ? '계산 누락 주문이 없습니다.' : '당월 주문 자료가 없습니다.'}
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => <OrderProfitTableRow key={row.orderId} row={row} />)
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          tab={data.missingOnly ? 'missing' : 'orders'}
        />
      </div>
    </div>
  )
}

function StatusSummaryCard({
  label,
  value,
  subLabel,
  tone = 'default',
}: {
  label: string
  value: number
  subLabel: string
  tone?: 'default' | 'complete' | 'warning'
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {tone === 'complete' ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : null}
        {tone === 'warning' ? <AlertCircle className="size-3.5 text-amber-600" /> : null}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value.toLocaleString('ko-KR')}건</div>
      <div className="mt-1 text-xs text-muted-foreground">{subLabel}</div>
    </div>
  )
}

function OrderProfitTableRow({ row }: { row: OrderProfitRow }) {
  const issues = getProfitIssues(row)

  return (
    <tr className="border-t align-top">
      <td className="px-3 py-2">
        <Link href={`/orders/${row.orderId}`} className="font-medium text-primary hover:underline">
          {row.internalNo}
        </Link>
        <div className="max-w-[180px] truncate text-xs text-muted-foreground">{row.marketplaceOrderId}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{formatDate(row.orderedAt)}</div>
      </td>
      <td className="px-3 py-2 font-medium">{row.marketplaceName}</td>
      <td className="max-w-[300px] px-3 py-2">
        <div className="truncate font-medium" title={row.productSummary}>{row.productSummary}</div>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={row.skuSummary}>
          {row.skuSummary}
        </div>
      </td>
      <td className="px-3 py-2">
        {issues.length === 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="size-3.5" />
            기초데이터 완료
          </span>
        ) : (
          <div className="flex max-w-[240px] flex-wrap gap-1">
            {issues.map((issue) => (
              <span key={issue} className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                {issue}
              </span>
            ))}
          </div>
        )}
      </td>
      <Td>{formatWon(row.sales)}</Td>
      <Td className={row.missingFee ? 'text-amber-700' : ''}>{formatWon(row.marketplaceFee)}</Td>
      <Td className={row.missingProductCost ? 'text-amber-700' : ''}>{formatWon(row.productCost)}</Td>
      <Td>{formatWon(row.paidShippingFee)}</Td>
      <Td className={row.missingActualShipping ? 'text-amber-700' : ''}>{formatWon(row.actualShippingFee)}</Td>
      <Td className={row.missingPackaging ? 'text-amber-700' : ''}>{formatWon(row.boxCost)}</Td>
      <Td className={row.finalProfit < 0 ? 'text-red-600' : 'text-emerald-700'}>{formatWon(row.finalProfit)}</Td>
      <Td>{row.profitRate == null ? '-' : formatPlainPercent(row.profitRate)}</Td>
    </tr>
  )
}

function getProfitIssues(row: OrderProfitRow): string[] {
  const issues: string[] = []
  if (row.missingFee) issues.push('수수료')
  if (row.missingProductCost) issues.push('상품원가')
  if (row.missingActualShipping) issues.push('실제배송비')
  if (row.missingPackaging) issues.push('박스정보')
  return issues
}

function Pagination({
  page,
  totalPages,
  tab,
}: {
  page: number
  totalPages: number
  tab: 'orders' | 'missing'
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
      <div className="text-muted-foreground">{page.toLocaleString('ko-KR')} / {totalPages.toLocaleString('ko-KR')} 페이지</div>
      <div className="flex gap-2">
        <PageLink href={`/analytics?tab=${tab}&page=${Math.max(1, page - 1)}`} disabled={page <= 1}>이전</PageLink>
        <PageLink href={`/analytics?tab=${tab}&page=${Math.min(totalPages, page + 1)}`} disabled={page >= totalPages}>다음</PageLink>
      </div>
    </div>
  )
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  return disabled ? (
    <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">{children}</span>
  ) : (
    <Link href={href} className="rounded-md border px-3 py-1.5 font-medium hover:bg-muted">{children}</Link>
  )
}

function UploadPanel({
  recent,
}: {
  recent: Awaited<ReturnType<typeof getActualShippingCostRecentImports>>
}) {
  return (
    <div className="space-y-4">
      <ActualShippingCostUpload />

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">최근 반영된 실제배송비</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>택배사</Th>
                <Th>운송장번호</Th>
                <Th align="right">실제배송비</Th>
                <Th>매칭</Th>
                <Th>파일</Th>
                <Th>반영일</Th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>
                    아직 반영된 실제배송비가 없습니다.
                  </td>
                </tr>
              ) : (
                recent.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="px-3 py-2">{carrierLabels[row.carrierId] ?? row.carrierId}</td>
                    <td className="px-3 py-2 font-mono">{row.trackingNumber}</td>
                    <td className="px-3 py-2 text-right">{formatWon(Number(row.actualFee))}</td>
                    <td className="px-3 py-2">{row.shipmentId ? '매칭됨' : '미매칭'}</td>
                    <td className="max-w-[220px] truncate px-3 py-2">{row.sourceFileName ?? '-'}</td>
                    <td className="px-3 py-2">{new Date(row.importedAt).toLocaleString('ko-KR')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SalesRow({ row, total = false }: { row: MarketplaceSalesRow; total?: boolean }) {
  return (
    <tr className={total ? 'border-t bg-muted/40 font-semibold' : 'border-t'}>
      <td className="px-3 py-2">
        <div className="font-medium">{row.marketplaceName}</div>
        {!total ? <div className="text-xs text-muted-foreground">{row.marketplaceId}</div> : null}
      </td>
      <Td>{formatWon(row.sales)}</Td>
      <Td>{formatWon(row.marketplaceFee)}</Td>
      <Td>{formatWon(row.productCost)}</Td>
      <Td>{formatWon(row.paidShippingFee)}</Td>
      <Td>{formatWon(row.actualShippingFee)}</Td>
      <Td className={row.shippingMargin < 0 ? 'text-red-600' : 'text-emerald-700'}>
        {formatWon(row.shippingMargin)}
      </Td>
      <Td>{formatWon(row.boxCost)}</Td>
      <Td className={row.finalProfit < 0 ? 'text-red-600' : 'text-emerald-700'}>
        {formatWon(row.finalProfit)}
      </Td>
      <Td>{row.profitRate == null ? '-' : formatPercent(row.profitRate)}</Td>
    </tr>
  )
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={[
        'rounded-md px-3 py-1.5 font-medium',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </Link>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-right tabular-nums ${className}`}>{children}</td>
}

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('ko-KR')}%`
}

function formatPlainPercent(value: number): string {
  return `${(Math.round(value * 10) / 10).toLocaleString('ko-KR')}%`
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)
}
