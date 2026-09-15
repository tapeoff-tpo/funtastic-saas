import Link from 'next/link'
import {
  PURCHASE_PAYMENT_FLOW_VIEW_LABELS,
  type PurchasePaymentFlowSort,
  type PurchasePaymentFlowDetailItem,
  type PurchasePaymentFlowView,
} from '@/lib/purchasing/purchase-requests'
import { PaymentFlowPendingLink } from './payment-flow-pending-link'
import { PaymentFlowProductSearch } from './payment-flow-product-search'
import {
  PurchaseBulkPaymentDialog,
  PurchaseBulkSelectionProvider,
  PurchasePaymentFlowBulkActions,
  PurchaseQuantityField,
  PurchaseRowCheckbox,
  PurchaseSelectAllCheckbox,
} from '../orders/purchase-request-actions'

export function PurchasePaymentFlowDetailList({
  view,
  search,
  items,
  total,
  page,
  pageSize,
  totalPages,
  sort,
  order,
}: {
  view: PurchasePaymentFlowView
  search: string
  items: PurchasePaymentFlowDetailItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  sort: PurchasePaymentFlowSort | null
  order: 'asc' | 'desc'
}) {
  const label = PURCHASE_PAYMENT_FLOW_VIEW_LABELS[view]
  const heading = view === 'outstanding'
    ? '현재 결제 대기 목록'
    : view === 'purchase_completed'
      ? '구매 완료 · 발주 차감 대상 목록'
      : `${label} 포함 주문 건`
  const pageStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(total, page * pageSize)

  return (
    <PurchaseBulkSelectionProvider key={`${view}:${search}:${page}:${pageSize}:${sort}:${order}`} ids={items.map((item) => item.id)} nextStatus={null}>
    <section id="payment-flow-details" className="overflow-hidden rounded-md border bg-background" aria-label={heading}>
      <PaymentFlowProductSearch key={`${view}:${search}`} view={view} search={search} pageSize={pageSize} sort={sort} order={order} />
      <div className="flex flex-col gap-3 border-b px-3 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-base font-semibold">{heading}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {search ? `“${search}” 검색 결과 ` : '총 '}{total.toLocaleString('ko-KR')}건 · {pageStart.toLocaleString('ko-KR')}-{pageEnd.toLocaleString('ko-KR')} 표시
          </p>
          {view === 'purchase_completed' ? (
            <p className="mt-1 text-xs text-muted-foreground">주문서번호가 있어 자동 차감 대상으로 분류된 현재 발주입니다. 이전 발주까지 포함한 실제 차감 기록은 아래 거래내역에서 확인할 수 있습니다.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'outstanding' ? <PurchasePaymentFlowBulkActions /> : null}
          <PurchaseBulkPaymentDialog />
          <form action="/purchasing/payment-flow" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="view" value={view} />
            {search ? <input type="hidden" name="search" value={search} /> : null}
            {sort ? <input type="hidden" name="sort" value={sort} /> : null}
            {sort ? <input type="hidden" name="order" value={order} /> : null}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>목록 보기</span>
              <select
                name="pageSize"
                defaultValue={pageSize}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                aria-label="목록 보기 개수"
              >
                {[10, 50, 100, 200].map((size) => <option key={size} value={size}>{size}개</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>페이지</span>
              <input
                name="page"
                type="number"
                inputMode="numeric"
                min={1}
                max={totalPages}
                defaultValue={page}
                className="h-8 w-16 rounded-md border border-input bg-background px-2 text-center text-sm tabular-nums text-foreground"
                aria-label="이동할 페이지"
              />
              <span>/ {totalPages.toLocaleString('ko-KR')}</span>
            </label>
            <button type="submit" className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted">
              이동
            </button>
          </form>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="px-3 py-10 text-center text-sm text-muted-foreground">{search ? '검색 결과가 없습니다.' : '해당 금액에 포함된 주문 건이 없습니다.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1350px] table-fixed text-center text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-[42px] whitespace-nowrap px-3 py-2 text-center font-medium">
                  <PurchaseSelectAllCheckbox />
                </th>
                <th className="w-[44px] whitespace-nowrap px-3 py-2 text-center font-medium">No.</th>
                <th className="w-[96px] whitespace-nowrap px-3 py-2 text-center font-medium">금액 구분</th>
                <th className="w-[112px] whitespace-nowrap px-3 py-2 text-center font-medium">대량결제</th>
                <th className="w-[250px] max-w-[250px] px-3 py-2 text-center font-medium">상품</th>
                <th className="w-[116px] whitespace-nowrap px-3 py-2 text-center font-medium">구매수량</th>
                <th className="w-[112px] whitespace-nowrap px-3 py-2 text-center font-medium">개당단가(元)</th>
                <th className="w-[124px] whitespace-nowrap px-3 py-2 text-center font-medium">개당단가(₩)</th>
                <th className="w-[180px] px-3 py-2 text-center font-medium">주문서번호</th>
                <th className="w-[108px] whitespace-nowrap px-3 py-2 text-center font-medium">
                  <PaymentFlowSortHeader label="합계(元)" column="totalCostYuan" view={view} search={search} pageSize={pageSize} currentSort={sort} currentOrder={order} />
                </th>
                <th className="w-[118px] whitespace-nowrap px-3 py-2 text-center font-medium">
                  <PaymentFlowSortHeader label="합계(₩)" column="totalCostKrw" view={view} search={search} pageSize={pageSize} currentSort={sort} currentOrder={order} />
                </th>
                <th className="w-[56px] whitespace-nowrap px-3 py-2 text-center font-medium">발주</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item, index) => (
                <tr key={item.id} className="align-middle hover:bg-muted/30">
                  <td className="px-3 py-2 text-center"><PurchaseRowCheckbox id={item.id} /></td>
                  <td className="px-3 py-2 text-center text-xs tabular-nums text-muted-foreground">
                    {((page - 1) * pageSize + index + 1).toLocaleString('ko-KR')}
                  </td>
                  <td className="px-3 py-2 text-center text-xs whitespace-nowrap">
                    {getPurchaseAmountCategory(item)}
                  </td>
                  <td className="px-3 py-2 text-center text-xs whitespace-nowrap">
                    {item.bulkPaymentPending ? (
                      <div>
                        <div className="font-medium text-amber-700">대량결제대기</div>
                        <div className="mt-0.5 text-muted-foreground">{item.bulkPaymentDueDate ?? '날짜 미지정'}</div>
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="break-words font-medium text-foreground">{item.productName}</div>
                    <div className="mt-0.5 break-words text-xs text-muted-foreground">
                      {item.sku}{item.optionName ? ` · ${item.optionName}` : ''}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center align-middle">
                    <PurchaseQuantityField
                      id={item.id}
                      field="actualPurchaseQuantity"
                      quantity={item.quantity}
                    />
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{formatCost(item.unitCostYuan, 2)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{formatCost(item.unitCostKrw, 0)}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    <div>{item.supplierOrderNumber ?? '-'}</div>
                    {item.purchaseManagementCode ? <div className="mt-0.5 text-muted-foreground">{item.purchaseManagementCode}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{formatCost(item.totalCostYuan, 2)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{formatCost(item.totalCostKrw, 0)}</td>
                  <td className="px-3 py-2 text-center">
                    <Link
                      href={`/purchasing/orders?status=${item.status}&search=${encodeURIComponent(item.purchaseManagementCode ?? item.sku)}`}
                      className="inline-flex h-7 items-center justify-center rounded-md border border-border bg-background px-2 text-xs font-medium hover:bg-muted"
                    >
                      보기
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm">
          <span className="text-xs text-muted-foreground">{pageStart.toLocaleString('ko-KR')}-{pageEnd.toLocaleString('ko-KR')} / {total.toLocaleString('ko-KR')}건</span>
          <div className="flex items-center gap-2">
            <PageLink view={view} search={search} page={page - 1} pageSize={pageSize} sort={sort} order={order} disabled={page <= 1}>이전</PageLink>
            <span className="text-xs tabular-nums text-muted-foreground">{page.toLocaleString('ko-KR')} / {totalPages.toLocaleString('ko-KR')}</span>
            <PageLink view={view} search={search} page={page + 1} pageSize={pageSize} sort={sort} order={order} disabled={page >= totalPages}>다음</PageLink>
          </div>
        </div>
      ) : null}
    </section>
    </PurchaseBulkSelectionProvider>
  )
}

function PageLink({
  view,
  search,
  page,
  pageSize,
  sort,
  order,
  disabled,
  children,
}: {
  view: PurchasePaymentFlowView
  search: string
  page: number
  pageSize: number
  sort: PurchasePaymentFlowSort | null
  order: 'asc' | 'desc'
  disabled: boolean
  children: React.ReactNode
}) {
  if (disabled) {
    return <span className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-sm text-muted-foreground/50">{children}</span>
  }

  const params = new URLSearchParams({ view, page: String(page) })
  if (search) params.set('search', search)
  if (pageSize !== 50) params.set('pageSize', String(pageSize))
  if (sort) {
    params.set('sort', sort)
    params.set('order', order)
  }
  return (
    <PaymentFlowPendingLink href={`/purchasing/payment-flow?${params.toString()}#payment-flow-details`} className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted">
      {children}
    </PaymentFlowPendingLink>
  )
}

function PaymentFlowSortHeader({
  label,
  column,
  view,
  search,
  pageSize,
  currentSort,
  currentOrder,
}: {
  label: string
  column: PurchasePaymentFlowSort
  view: PurchasePaymentFlowView
  search: string
  pageSize: number
  currentSort: PurchasePaymentFlowSort | null
  currentOrder: 'asc' | 'desc'
}) {
  const nextOrder = currentSort === column && currentOrder === 'asc' ? 'desc' : 'asc'
  const indicator = currentSort === column ? (currentOrder === 'asc' ? '↑' : '↓') : ''
  const params = new URLSearchParams({ view, sort: column, order: nextOrder })
  if (search) params.set('search', search)
  if (pageSize !== 50) params.set('pageSize', String(pageSize))

  return (
    <PaymentFlowPendingLink
      href={`/purchasing/payment-flow?${params.toString()}`}
      scroll={false}
      className="inline-flex w-full items-center justify-center gap-1 hover:text-foreground"
    >
      {label}
      <span className="text-muted-foreground">{indicator}</span>
    </PaymentFlowPendingLink>
  )
}

function formatCost(value: number | null, maximumFractionDigits: number) {
  if (value === null) return '-'
  return value.toLocaleString('ko-KR', { maximumFractionDigits })
}

function getPurchaseAmountCategory(item: PurchasePaymentFlowDetailItem) {
  if (item.supplierOrderNumber?.trim()) return '구매 완료'
  if (item.status === 'purchased') return '발주요청 · 결제 대기'
  return '결제 대기'
}
