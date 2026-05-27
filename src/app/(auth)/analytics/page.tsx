import type { Metadata } from 'next'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getActualShippingCostRecentImports } from '@/lib/shipping/actual-costs'
import { getSalesDashboardData, type MarketplaceSalesRow } from '@/lib/analytics/sales-dashboard'
import { ActualShippingCostUpload } from './actual-shipping-cost-upload'

export const metadata: Metadata = {
  title: '매출분석',
}

const carrierLabels: Record<string, string> = {
  CJGLS: 'CJ대한통운',
  KDEXP: '경동택배',
  DAESIN: '대신택배',
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const tab = (await searchParams)?.tab === 'uploads' ? 'uploads' : 'dashboard'
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [dashboard, recent] = await Promise.all([
    getSalesDashboardData(workspaceUserId),
    getActualShippingCostRecentImports(workspaceUserId),
  ])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">매출분석</h1>
          <p className="text-sm text-muted-foreground">
            {dashboard.currentMonthLabel} 기준 매출과 이익을 실시간으로 계산합니다.
          </p>
        </div>
        <div className="inline-flex w-fit rounded-lg border bg-background p-1 text-sm">
          <TabLink href="/analytics" active={tab === 'dashboard'}>대시보드</TabLink>
          <TabLink href="/analytics?tab=uploads" active={tab === 'uploads'}>업로드</TabLink>
        </div>
      </div>

      {tab === 'uploads' ? (
        <UploadPanel recent={recent} />
      ) : (
        <DashboardPanel rows={dashboard.rows} totals={dashboard.totals} cards={dashboard.cards} />
      )}
    </div>
  )
}

function DashboardPanel({
  cards,
  rows,
  totals,
}: {
  cards: Awaited<ReturnType<typeof getSalesDashboardData>>['cards']
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
