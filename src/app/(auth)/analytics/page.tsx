import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, ExternalLink, Search } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { listBoxCostRates } from '@/lib/analytics/box-costs'
import { getActualShippingCostRecentImports } from '@/lib/shipping/actual-costs'
import {
  analyticsMonthKey,
  emptyOrderProfitAnalysisData,
  emptyProductProfitAnalysisData,
  emptySalesDashboardData,
  getCachedOrderProfitAnalysisData,
  getCachedProductProfitAnalysisData,
  getCachedSalesDashboardData,
  type OrderProfitAnalysisData,
  type OrderProfitRow,
  type OrderProfitSort,
  type ProductProfitAnalysisData,
  type ProductProfitRow,
  type ProductProfitSort,
  type ProfitMissingIssue,
  type SortDirection,
  type SalesComparisonData,
  type MarketplaceSalesRow,
} from '@/lib/analytics/sales-dashboard'
import { ProductCostUpload } from '@/components/product-cost-upload'
import { ActualShippingCostUpload } from './actual-shipping-cost-upload'
import { BoxCostSettings } from './box-cost-settings'

export const metadata: Metadata = {
  title: '매출분석',
}

const carrierLabels: Record<string, string> = {
  CJGLS: 'CJ대한통운',
  KDEXP: '경동택배',
  DAESIN: '대신택배',
}

type AnalyticsTab = 'dashboard' | 'orders' | 'products' | 'missing' | 'uploads' | 'settings'

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    tab?: string
    page?: string
    issue?: string
    month?: string
    productSearch?: string
    productSort?: string
    productDirection?: string
    orderSearch?: string
    orderSort?: string
    orderDirection?: string
  }>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const params = await searchParams
  const tab = parseTab(params?.tab)
  const page = Math.max(1, Number.parseInt(params?.page ?? '1', 10) || 1)
  const issue = parseMissingIssue(params?.issue)
  const month = /^\d{4}-\d{2}$/.test(params?.month ?? '') ? params!.month! : analyticsMonthKey()
  const productSearch = params?.productSearch?.trim() ?? ''
  const productSort = parseProductProfitSort(params?.productSort)
  const productDirection: SortDirection = params?.productDirection === 'asc' ? 'asc' : 'desc'
  const orderSearch = params?.orderSearch?.trim() ?? ''
  const orderSort = parseOrderProfitSort(params?.orderSort)
  const orderDirection: SortDirection = params?.orderDirection === 'asc' ? 'asc' : 'desc'
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const dashboard = tab === 'dashboard'
    ? await getCachedSalesDashboardData(workspaceUserId, month).catch((error) => {
      console.error('sales analytics dashboard error:', error)
      return emptySalesDashboardData(new Date(`${month}-01T00:00:00`))
    })
    : emptySalesDashboardData()
  const profitData = tab === 'orders' || tab === 'missing'
    ? await getCachedOrderProfitAnalysisData(
      workspaceUserId,
      page,
      tab === 'missing',
      tab === 'missing' ? issue : 'all',
      month,
      orderSearch,
      orderSort,
      orderDirection,
    ).catch((error) => {
      console.error('order profit analysis error:', error)
      return emptyOrderProfitAnalysisData({
        page,
        missingOnly: tab === 'missing',
        issue: tab === 'missing' ? issue : 'all',
        now: new Date(`${month}-01T00:00:00`),
      })
    })
    : null
  const productData = tab === 'products'
    ? await getCachedProductProfitAnalysisData(
      workspaceUserId,
      month,
      productSearch,
      productSort,
      productDirection,
    ).catch((error) => {
      console.error('product profit analysis error:', error)
      return emptyProductProfitAnalysisData(new Date(`${month}-01T00:00:00`))
    })
    : null
  const recent = tab === 'uploads'
    ? await getActualShippingCostRecentImports(workspaceUserId).catch((error) => {
      console.error('actual shipping cost recent import error:', error)
      return []
    })
    : []
  const boxCostRates = tab === 'settings'
    ? await listBoxCostRates(workspaceUserId).catch((error) => {
      console.error('box cost settings error:', error)
      return []
    })
    : []

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">매출분석</h1>
          <p className="text-sm text-muted-foreground">
            {selectedMonthLabel(month)} 기준 매출과 이익을 계산합니다.
          </p>
        </div>
        <div className="flex w-fit flex-wrap rounded-lg border bg-background p-1 text-sm">
          <TabLink href={analyticsHref('dashboard', month)} active={tab === 'dashboard'}>대시보드</TabLink>
          <TabLink href={analyticsHref('orders', month)} active={tab === 'orders'}>주문별 손익</TabLink>
          <TabLink href={analyticsHref('products', month)} active={tab === 'products'}>상품별 손익</TabLink>
          <TabLink href={analyticsHref('missing', month)} active={tab === 'missing'}>계산 누락</TabLink>
          <TabLink href={analyticsHref('uploads', month)} active={tab === 'uploads'}>업로드</TabLink>
          <TabLink href={analyticsHref('settings', month)} active={tab === 'settings'}>설정</TabLink>
          <TopNavLink href="/analytics/price-table">판매가 테이블</TopNavLink>
          <TopNavLink href="/analytics/sabangnet-review">사방넷 검수</TopNavLink>
          <TopNavLink href="/analytics/short-meeting">숏미팅</TopNavLink>
        </div>
      </div>

      <MonthSelector
        month={month}
        tab={tab}
        productSearch={productSearch}
        productSort={productSort}
        productDirection={productDirection}
        orderSearch={orderSearch}
        orderSort={orderSort}
        orderDirection={orderDirection}
      />

      {tab === 'uploads' ? (
        <UploadPanel recent={recent} />
      ) : tab === 'settings' ? (
        <BoxCostSettings rates={boxCostRates} />
      ) : tab === 'products' ? (
        <ProductProfitPanel
          data={productData!}
          month={month}
          search={productSearch}
          sort={productSort}
          direction={productDirection}
        />
      ) : tab === 'orders' || tab === 'missing' ? (
        <OrderProfitPanel
          data={profitData!}
          month={month}
          search={orderSearch}
          sort={orderSort}
          direction={orderDirection}
        />
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
  if (value === 'orders' || value === 'products' || value === 'missing' || value === 'uploads' || value === 'settings') return value
  return 'dashboard'
}

function parseMissingIssue(value: string | undefined): ProfitMissingIssue {
  if (value === 'fee' || value === 'product-cost' || value === 'actual-shipping' || value === 'packaging') return value
  return 'all'
}

function parseProductProfitSort(value: string | undefined): ProductProfitSort {
  const values: ProductProfitSort[] = [
    'product',
    'quantity',
    'order-count',
    'sales',
    'marketplace-fee',
    'product-cost',
    'paid-shipping',
    'actual-shipping',
    'box-cost',
    'final-profit',
    'profit-rate',
  ]
  return values.includes(value as ProductProfitSort) ? value as ProductProfitSort : 'sales'
}

function parseOrderProfitSort(value: string | undefined): OrderProfitSort {
  const values: OrderProfitSort[] = [
    'order',
    'ordered-at',
    'marketplace',
    'product',
    'calculation-status',
    'sales',
    'marketplace-fee',
    'product-cost',
    'paid-shipping',
    'actual-shipping',
    'box-cost',
    'final-profit',
    'profit-rate',
  ]
  return values.includes(value as OrderProfitSort) ? value as OrderProfitSort : 'ordered-at'
}

function MonthSelector({
  month,
  tab,
  productSearch,
  productSort,
  productDirection,
  orderSearch,
  orderSort,
  orderDirection,
}: {
  month: string
  tab: AnalyticsTab
  productSearch: string
  productSort: ProductProfitSort
  productDirection: SortDirection
  orderSearch: string
  orderSort: OrderProfitSort
  orderDirection: SortDirection
}) {
  const targetTab = tab === 'uploads' || tab === 'settings' ? 'dashboard' : tab
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-lg border bg-card px-4 py-3">
      <input type="hidden" name="tab" value={targetTab} />
      {tab === 'products' ? (
        <>
          <input type="hidden" name="productSearch" value={productSearch} />
          <input type="hidden" name="productSort" value={productSort} />
          <input type="hidden" name="productDirection" value={productDirection} />
        </>
      ) : null}
      {tab === 'orders' || tab === 'missing' ? (
        <>
          <input type="hidden" name="orderSearch" value={orderSearch} />
          <input type="hidden" name="orderSort" value={orderSort} />
          <input type="hidden" name="orderDirection" value={orderDirection} />
        </>
      ) : null}
      <label className="space-y-1">
        <span className="block text-xs font-medium text-muted-foreground">조회 월</span>
        <input
          type="month"
          name="month"
          defaultValue={month}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        />
      </label>
      <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        월별 조회
      </button>
      {tab === 'uploads' || tab === 'settings' ? (
        <span className="pb-2 text-xs text-muted-foreground">월을 선택하면 대시보드로 이동합니다.</span>
      ) : null}
    </form>
  )
}

function DashboardPanel({
  cards,
  comparison,
  rows,
  totals,
}: {
  cards: Awaited<ReturnType<typeof getCachedSalesDashboardData>>['cards']
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
              선택 월 동기간 {formatWon(comparison.currentSamePeriodSales)}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>구분</Th>
                <Th align="right">매출총금액</Th>
                <Th align="right">선택 월과 동기간 매출금액</Th>
                <Th align="right">선택 월 동기간 대비</Th>
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
                    선택한 월의 매출 자료가 없습니다.
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

function ProductProfitPanel({
  data,
  month,
  search,
  sort,
  direction,
}: {
  data: ProductProfitAnalysisData
  month: string
  search: string
  sort: ProductProfitSort
  direction: SortDirection
}) {
  const sortHeader = (label: string, column: ProductProfitSort) => (
    <ProductSortHeader
      label={label}
      column={column}
      month={month}
      search={search}
      activeSort={sort}
      direction={direction}
    />
  )

  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2 rounded-lg border bg-card px-4 py-3">
        <input type="hidden" name="tab" value="products" />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="productSort" value={sort} />
        <input type="hidden" name="productDirection" value={direction} />
        <label className="min-w-[260px] flex-1 space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">상품 검색</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="productSearch"
              defaultValue={search}
              placeholder="상품명 또는 내부상품코드"
              className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm"
            />
          </div>
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          조회
        </button>
        {search ? (
          <Link href={analyticsHref('products', month)} className="h-9 rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted">
            초기화
          </Link>
        ) : null}
      </form>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">상품별 손익</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.currentMonthLabel} 확정 상품 기준이며, 열 제목을 눌러 정렬할 수 있습니다.
          </p>
        </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1500px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              {sortHeader('확정상품 / 내부상품코드', 'product')}
              {sortHeader('판매수량', 'quantity')}
              {sortHeader('상품 주문건수', 'order-count')}
              {sortHeader('매출', 'sales')}
              {sortHeader('수수료', 'marketplace-fee')}
              {sortHeader('상품원가', 'product-cost')}
              {sortHeader('결제배송비', 'paid-shipping')}
              {sortHeader('실제배송비', 'actual-shipping')}
              {sortHeader('박스비', 'box-cost')}
              {sortHeader('최종 이익금', 'final-profit')}
              {sortHeader('이익률', 'profit-rate')}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td className="px-3 py-10 text-center text-muted-foreground" colSpan={11}>
                  선택한 월의 상품별 손익 데이터가 없습니다.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => <ProductProfitTableRow key={row.sku} row={row} />)
            )}
            {data.rows.length > 0 ? <ProductProfitTableRow row={data.totals} total /> : null}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  )
}

function ProductSortHeader({
  label,
  column,
  month,
  search,
  activeSort,
  direction,
}: {
  label: string
  column: ProductProfitSort
  month: string
  search: string
  activeSort: ProductProfitSort
  direction: SortDirection
}) {
  const active = activeSort === column
  const nextDirection: SortDirection = active && direction === 'desc' ? 'asc' : 'desc'
  const params = new URLSearchParams({
    tab: 'products',
    month,
    productSort: column,
    productDirection: nextDirection,
  })
  if (search) params.set('productSearch', search)

  return (
    <th className={`px-3 py-2 font-medium ${column === 'product' ? 'text-left' : 'text-right'}`}>
      <Link
        href={`/analytics?${params.toString()}`}
        className={`inline-flex items-center gap-1 hover:text-foreground ${column === 'product' ? '' : 'justify-end'}`}
      >
        {label}
        {active ? (
          direction === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
        ) : (
          <ArrowUpDown className="size-3.5 opacity-50" />
        )}
      </Link>
    </th>
  )
}

function ProductProfitTableRow({ row, total = false }: { row: ProductProfitRow; total?: boolean }) {
  return (
    <tr className={total ? 'border-t bg-muted/40 font-semibold' : 'border-t'}>
      <td className="max-w-[320px] px-3 py-2">
        <div className="truncate font-medium" title={row.productName}>{row.productName}</div>
        <div className="truncate font-mono text-xs text-muted-foreground" title={row.sku}>{row.sku}</div>
      </td>
      <Td>{formatQuantity(row.quantity)}</Td>
      <Td>{Math.round(row.orderCount).toLocaleString('ko-KR')}건</Td>
      <Td>{formatWon(row.sales)}</Td>
      <Td>{formatWon(row.marketplaceFee)}</Td>
      <Td>{formatWon(row.productCost)}</Td>
      <Td>{formatWon(row.paidShippingFee)}</Td>
      <Td>{formatWon(row.actualShippingFee)}</Td>
      <Td>{formatWon(row.boxCost)}</Td>
      <Td className={row.finalProfit < 0 ? 'text-red-600' : 'text-emerald-700'}>{formatWon(row.finalProfit)}</Td>
      <Td>{row.profitRate == null ? '-' : formatPlainPercent(row.profitRate)}</Td>
    </tr>
  )
}

function OrderProfitPanel({
  data,
  month,
  search,
  sort,
  direction,
}: {
  data: OrderProfitAnalysisData
  month: string
  search: string
  sort: OrderProfitSort
  direction: SortDirection
}) {
  const completeRate = data.summary.totalOrders > 0
    ? (data.summary.completeOrders / data.summary.totalOrders) * 100
    : 0
  const tab = data.missingOnly ? 'missing' : 'orders'
  const sortHeader = (label: string, column: OrderProfitSort, align: 'left' | 'right' = 'right') => (
    <OrderSortHeader
      label={label}
      column={column}
      align={align}
      month={month}
      search={search}
      activeSort={sort}
      direction={direction}
      tab={tab}
      issue={data.selectedIssue}
    />
  )

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2 rounded-lg border bg-card px-4 py-3">
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="orderSort" value={sort} />
        <input type="hidden" name="orderDirection" value={direction} />
        {data.missingOnly && data.selectedIssue !== 'all' ? <input type="hidden" name="issue" value={data.selectedIssue} /> : null}
        <label className="min-w-[280px] flex-1 space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">주문 검색</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="orderSearch"
              defaultValue={search}
              placeholder="주문번호, 쇼핑몰, 상품명 또는 내부상품코드"
              className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm"
            />
          </div>
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          조회
        </button>
        {search ? (
          <Link href={analyticsHref(tab, month, data.selectedIssue)} className="h-9 rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted">
            초기화
          </Link>
        ) : null}
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <StatusSummaryCard
          label="전체 주문"
          value={data.summary.totalOrders}
          subLabel={`${data.currentMonthLabel} 주문 기준`}
          href={data.missingOnly ? analyticsHref('missing', month) : undefined}
          active={data.missingOnly && data.selectedIssue === 'all'}
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
          href={analyticsHref('missing', month, 'fee')}
          active={data.selectedIssue === 'fee'}
        />
        <StatusSummaryCard
          label="상품원가 누락"
          value={data.summary.missingProductCostOrders}
          subLabel="내부상품코드 또는 원가"
          href={analyticsHref('missing', month, 'product-cost')}
          active={data.selectedIssue === 'product-cost'}
        />
        <StatusSummaryCard
          label="실제배송비 누락"
          value={data.summary.missingActualShippingOrders}
          subLabel="송장 또는 택배비 매칭"
          href={analyticsHref('missing', month, 'actual-shipping')}
          active={data.selectedIssue === 'actual-shipping'}
        />
        <StatusSummaryCard
          label="박스비 누락"
          value={data.summary.missingPackagingOrders}
          subLabel="박스명 또는 단가"
          href={analyticsHref('missing', month, 'packaging')}
          active={data.selectedIssue === 'packaging'}
        />
      </div>

      {data.missingOnly ? <MissingWorkGuide selectedIssue={data.selectedIssue} month={month} /> : null}

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
          <table className="w-full min-w-[1880px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {sortHeader('주문 / 주문일', 'ordered-at', 'left')}
                {sortHeader('쇼핑몰', 'marketplace', 'left')}
                {sortHeader('확정상품 / 내부상품코드', 'product', 'left')}
                {sortHeader('계산 상태', 'calculation-status', 'left')}
                <Th>누락 상세</Th>
                <Th>처리</Th>
                {sortHeader('매출', 'sales')}
                {sortHeader('수수료', 'marketplace-fee')}
                {sortHeader('상품원가', 'product-cost')}
                {sortHeader('결제배송비', 'paid-shipping')}
                {sortHeader('실제배송비', 'actual-shipping')}
                {sortHeader('박스비', 'box-cost')}
                {sortHeader('최종 이익금', 'final-profit')}
                {sortHeader('이익률', 'profit-rate')}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-10 text-center text-muted-foreground" colSpan={14}>
                    {data.missingOnly ? '계산 누락 주문이 없습니다.' : '선택한 월의 주문 자료가 없습니다.'}
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
          issue={data.selectedIssue}
          month={month}
          search={search}
          sort={sort}
          direction={direction}
        />
      </div>
    </div>
  )
}

function OrderSortHeader({
  label,
  column,
  align,
  month,
  search,
  activeSort,
  direction,
  tab,
  issue,
}: {
  label: string
  column: OrderProfitSort
  align: 'left' | 'right'
  month: string
  search: string
  activeSort: OrderProfitSort
  direction: SortDirection
  tab: 'orders' | 'missing'
  issue: ProfitMissingIssue
}) {
  const active = activeSort === column
  const nextDirection: SortDirection = active && direction === 'desc' ? 'asc' : 'desc'
  const params = new URLSearchParams({
    tab,
    month,
    orderSort: column,
    orderDirection: nextDirection,
  })
  if (search) params.set('orderSearch', search)
  if (tab === 'missing' && issue !== 'all') params.set('issue', issue)

  return (
    <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <Link
        href={`/analytics?${params.toString()}`}
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === 'right' ? 'justify-end' : ''}`}
      >
        {label}
        {active ? (
          direction === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
        ) : (
          <ArrowUpDown className="size-3.5 opacity-50" />
        )}
      </Link>
    </th>
  )
}

function StatusSummaryCard({
  label,
  value,
  subLabel,
  tone = 'default',
  href,
  active = false,
}: {
  label: string
  value: number
  subLabel: string
  tone?: 'default' | 'complete' | 'warning'
  href?: string
  active?: boolean
}) {
  const content = (
    <div className={`rounded-lg border bg-card p-4 ${active ? 'border-primary ring-1 ring-primary' : ''}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {tone === 'complete' ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : null}
        {tone === 'warning' ? <AlertCircle className="size-3.5 text-amber-600" /> : null}
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value.toLocaleString('ko-KR')}건</div>
      <div className="mt-1 text-xs text-muted-foreground">{subLabel}</div>
    </div>
  )
  return href ? <Link href={href} className="block hover:bg-muted/20">{content}</Link> : content
}

function MissingWorkGuide({ selectedIssue, month }: { selectedIssue: ProfitMissingIssue; month: string }) {
  const guides: Record<ProfitMissingIssue, { title: string; description: string; action?: { href: string; label: string } }> = {
    all: {
      title: '누락 주문 처리',
      description: '누락 종류를 선택하면 해당 주문만 모아서 볼 수 있습니다. 수정 후 이 화면을 새로 열면 즉시 다시 계산됩니다.',
    },
    fee: {
      title: '수수료 누락',
      description: '쇼핑몰 연결 계정의 매출 설정에 수수료율이 없습니다.',
      action: { href: '/settings/marketplaces', label: '쇼핑몰 수수료 설정' },
    },
    'product-cost': {
      title: '상품원가 누락',
      description: '내부상품코드가 없거나 발주 품목에 원가가 등록되지 않았습니다.',
      action: { href: '/purchasing/items', label: '발주 품목 관리' },
    },
    'actual-shipping': {
      title: '실제배송비 누락',
      description: '송장이 없거나 택배사 실제배송비 파일과 매칭되지 않았습니다.',
      action: { href: '/analytics?tab=uploads', label: '실제배송비 업로드' },
    },
    packaging: {
      title: '박스비 누락',
      description: '박스명이 없거나 인식된 박스명과 동일한 단가 설정이 없습니다.',
      action: { href: '/analytics?tab=settings', label: '박스단가 설정' },
    },
  }
  const guide = guides[selectedIssue]
  const filters: Array<{ issue: ProfitMissingIssue; label: string }> = [
    { issue: 'all', label: '전체 누락' },
    { issue: 'fee', label: '수수료' },
    { issue: 'product-cost', label: '상품원가' },
    { issue: 'actual-shipping', label: '실제배송비' },
    { issue: 'packaging', label: '박스비' },
  ]

  return (
    <div className="flex flex-col gap-3 border-y bg-muted/30 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="font-medium">{guide.title}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">{guide.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <Link
            key={filter.issue}
            href={analyticsHref('missing', month, filter.issue)}
            className={[
              'rounded-md border px-2.5 py-1.5 text-xs font-medium',
              selectedIssue === filter.issue ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
            ].join(' ')}
          >
            {filter.label}
          </Link>
        ))}
        {guide.action ? <ActionLink href={guide.action.href}>{guide.action.label}</ActionLink> : null}
      </div>
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
      <td className="max-w-[280px] px-3 py-2 text-xs">
        {row.missingProductCost ? <IssueDetail label="원가 대상" value={row.skuSummary} /> : null}
        {row.missingActualShipping ? <IssueDetail label="미매칭 송장" value={row.trackingSummary} /> : null}
        {row.missingPackaging ? <IssueDetail label="인식 박스명" value={row.packageSummary} /> : null}
        {row.missingFee ? <IssueDetail label="수수료" value={`${row.marketplaceName} 연결 계정에 미설정`} /> : null}
      </td>
      <td className="px-3 py-2">
        <div className="flex max-w-[230px] flex-wrap gap-1.5">
          {row.missingFee ? <ActionLink href="/settings/marketplaces">수수료 설정</ActionLink> : null}
          {row.missingProductCost ? <ActionLink href={`/purchasing/items?f0=${encodeURIComponent(firstSku(row.skuSummary))}`}>품목 확인</ActionLink> : null}
          {row.missingActualShipping ? <ActionLink href="/analytics?tab=uploads">배송비 업로드</ActionLink> : null}
          {row.missingPackaging ? (
            <>
              <ActionLink href={`/inventory?search=${encodeURIComponent(firstSku(row.skuSummary))}&searched=1`}>박스명 확인</ActionLink>
              <ActionLink href="/analytics?tab=settings">박스단가 설정</ActionLink>
            </>
          ) : null}
        </div>
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

function IssueDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-1 last:mb-0">
      <span className="font-medium text-amber-800">{label}: </span>
      <span className="text-muted-foreground" title={value}>{value}</span>
    </div>
  )
}

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted">
      {children}
      <ExternalLink className="size-3" />
    </Link>
  )
}

function firstSku(value: string): string {
  return value.split(',')[0]?.trim() || value
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
  issue,
  month,
  search,
  sort,
  direction,
}: {
  page: number
  totalPages: number
  tab: 'orders' | 'missing'
  issue: ProfitMissingIssue
  month: string
  search: string
  sort: OrderProfitSort
  direction: SortDirection
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
      <div className="text-muted-foreground">{page.toLocaleString('ko-KR')} / {totalPages.toLocaleString('ko-KR')} 페이지</div>
      <div className="flex gap-2">
        <PageLink href={paginationHref(tab, issue, Math.max(1, page - 1), month, search, sort, direction)} disabled={page <= 1}>이전</PageLink>
        <PageLink href={paginationHref(tab, issue, Math.min(totalPages, page + 1), month, search, sort, direction)} disabled={page >= totalPages}>다음</PageLink>
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

function paginationHref(
  tab: 'orders' | 'missing',
  issue: ProfitMissingIssue,
  page: number,
  month: string,
  search: string,
  sort: OrderProfitSort,
  direction: SortDirection,
): string {
  const params = new URLSearchParams({
    tab,
    month,
    page: String(page),
    orderSort: sort,
    orderDirection: direction,
  })
  if (search) params.set('orderSearch', search)
  if (tab === 'missing' && issue !== 'all') params.set('issue', issue)
  return `/analytics?${params.toString()}`
}

function UploadPanel({
  recent,
}: {
  recent: Awaited<ReturnType<typeof getActualShippingCostRecentImports>>
}) {
  return (
    <div className="space-y-4">
      <ProductCostUpload />
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

function TopNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-transparent px-3 py-1.5 font-medium text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
    >
      {children}
    </Link>
  )
}

function analyticsHref(tab: AnalyticsTab, month: string, issue?: ProfitMissingIssue): string {
  const params = new URLSearchParams({ tab, month })
  if (issue && issue !== 'all') params.set('issue', issue)
  return `/analytics?${params.toString()}`
}

function selectedMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-')
  return `${year}년 ${Number(monthNumber)}월`
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

function formatQuantity(value: number): string {
  return `${(Math.round(value * 100) / 100).toLocaleString('ko-KR')}개`
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
