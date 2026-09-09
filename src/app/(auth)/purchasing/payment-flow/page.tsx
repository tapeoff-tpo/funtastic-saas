import Link from 'next/link'
import type { Metadata } from 'next'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import {
  getPurchasePaymentFlowDetailPage,
  getPurchasePaymentFlowSummary,
  getPurchasePaymentFlowViewSummary,
  PURCHASE_PAYMENT_FLOW_SORTS,
  PURCHASE_PAYMENT_FLOW_VIEWS,
  type PurchasePaymentFlowSort,
  type PurchasePaymentFlowView,
} from '@/lib/purchasing/purchase-requests'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { PurchasePaymentFlowDetailList } from './purchase-payment-flow-detail-list'
import { PurchasePaymentFlowSummaryPanel } from './purchase-payment-flow-summary'

export const metadata: Metadata = {
  title: '발주금액',
}

const PAYMENT_FLOW_PAGE_SIZES = [10, 50, 100, 200] as const

export default async function PurchasePaymentFlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const view = parsePaymentFlowView(stringParam(params.view)) ?? 'total'
  const sort = parsePaymentFlowSort(stringParam(params.sort))
  const order = parseSortOrder(stringParam(params.order)) ?? 'desc'
  const pageSize = parsePageSize(stringParam(params.pageSize))
  const requestedPage = Math.max(1, Number(stringParam(params.page) ?? '1') || 1)
  const user = await getCurrentUser()
  if (!user) return null

  const [workspaceUserId, exchangeRateReference] = await Promise.all([
    getWorkspaceUserId(user.id),
    getLatestCnyKrwReferenceRate(),
  ])
  const [summary, initialDetailPage] = await Promise.all([
    getPurchasePaymentFlowSummary(workspaceUserId, exchangeRateReference.rate),
    getPurchasePaymentFlowDetailPage({
      userId: workspaceUserId,
      fallbackExchangeRateKrw: exchangeRateReference.rate,
      view,
      page: requestedPage,
      pageSize,
      sort,
      order,
    }),
  ])
  const total = getPurchasePaymentFlowViewSummary(summary, view).itemCount
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const detailPage = page === requestedPage
    ? initialDetailPage
    : await getPurchasePaymentFlowDetailPage({
      userId: workspaceUserId,
      fallbackExchangeRateKrw: exchangeRateReference.rate,
      view,
      page,
      pageSize,
      sort,
      order,
    })

  return (
    <div className="space-y-5">
      <ProductFlowNav />
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">발주금액</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            금액 항목을 누르면 해당 금액에 포함된 발주 건을 바로 확인할 수 있습니다.
          </p>
        </div>
        <Link
          href="/purchasing/orders"
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          발주 목록 보기
        </Link>
      </header>

      <PurchasePaymentFlowSummaryPanel
        summary={summary}
        exchangeRateReference={exchangeRateReference}
        activeView={view}
        pageSize={pageSize}
        sort={sort}
        order={order}
      />
      <PurchasePaymentFlowDetailList
        view={view}
        items={detailPage.items}
        total={total}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        sort={sort}
        order={order}
      />
    </div>
  )
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parsePaymentFlowView(value: string | undefined): PurchasePaymentFlowView | null {
  return PURCHASE_PAYMENT_FLOW_VIEWS.includes(value as PurchasePaymentFlowView)
    ? value as PurchasePaymentFlowView
    : null
}

function parsePaymentFlowSort(value: string | undefined): PurchasePaymentFlowSort | null {
  return PURCHASE_PAYMENT_FLOW_SORTS.includes(value as PurchasePaymentFlowSort)
    ? value as PurchasePaymentFlowSort
    : null
}

function parseSortOrder(value: string | undefined): 'asc' | 'desc' | null {
  return value === 'asc' || value === 'desc' ? value : null
}

function parsePageSize(value: string | undefined) {
  const pageSize = Number(value)
  return PAYMENT_FLOW_PAGE_SIZES.includes(pageSize as (typeof PAYMENT_FLOW_PAGE_SIZES)[number])
    ? pageSize
    : 50
}
