import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { Button } from '@/components/ui/button'
import { getChinaWarehouseInventory } from '@/lib/purchasing/purchase-requests'

export const metadata: Metadata = {
  title: '중국재고',
}

export default async function ChinaInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const search = stringParam(params.search)
  const page = Math.max(1, Number(stringParam(params.page) ?? '1') || 1)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const { items, total, warehouseNames } = await getChinaWarehouseInventory({
    userId: workspaceUserId,
    search: search ?? undefined,
    page,
    pageSize: 50,
  })
  const totalPages = Math.max(1, Math.ceil(total / 50))

  return (
    <div className="space-y-4">
      <ProductFlowNav />
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">중국재고</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ecount 중국재고 원본의 합계와 창고별 수량을 나누어 조회합니다. 중국출고 후 국내 입고 전 수량은 발주 탭의 중국출고요청으로 관리합니다.
          </p>
        </div>
        <form className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center" action="/purchasing/china-inventory">
          <input
            name="search"
            defaultValue={search ?? ''}
            placeholder="품목코드, 상품명, 옵션"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-64"
          />
          <Button type="submit" variant="outline" className="w-full sm:w-auto">검색</Button>
        </form>
      </header>

      <section className="overflow-hidden rounded-md border bg-background">
        <div className="flex flex-col gap-1 border-b px-3 py-2">
          <h2 className="text-sm font-semibold">중국재고 위치별 목록</h2>
          <p className="text-xs text-muted-foreground">총 {total.toLocaleString('ko-KR')}건</p>
        </div>

        <div className="space-y-2 p-3 md:hidden">
          {items.length === 0 ? (
            <p className="px-3 py-12 text-center text-sm text-muted-foreground">조건에 맞는 중국창고 재고가 없습니다.</p>
          ) : items.map((item) => {
            const locations = warehouseNames.filter((warehouseName) => (item.warehouseQuantities[warehouseName] ?? 0) > 0)
            return (
              <article key={item.id} className="rounded-lg border bg-background p-3">
                <div className="min-w-0">
                  <p className="truncate whitespace-nowrap text-sm font-medium tabular-nums">{item.sku}</p>
                  <p className="mt-1 truncate text-sm font-medium">{item.productName}</p>
                  <p className="mt-1 truncate whitespace-nowrap text-xs text-muted-foreground">{item.optionName || '-'}</p>
                </div>
                <dl className="mt-3 grid grid-cols-2 divide-x rounded-md border bg-muted/20 text-center">
                  <MobileStockMetric label="총 재고" value={item.totalQuantity} />
                  <MobileStockMetric label="가용 재고" value={item.availableQuantity} emphasis />
                </dl>
                {locations.length > 0 ? (
                  <div className="mt-3 rounded-md bg-muted/20 px-3 py-2 text-xs">
                    <p className="font-medium text-muted-foreground">위치별 재고</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {locations.map((warehouseName) => (
                        <span key={warehouseName} className="whitespace-nowrap tabular-nums">
                          {warehouseName} {item.warehouseQuantities[warehouseName].toLocaleString('ko-KR')}개
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <p>최근 입고 {formatDateTime(item.lastArrivedAt)}</p>
                  <p>최근 중국출고요청 {formatDateTime(item.lastOutboundRequestedAt)}</p>
                </div>
              </article>
            )
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1500px] text-left text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-32 px-3 py-2 font-medium">품목코드</th>
                <th className="px-3 py-2 font-medium">상품</th>
                <th className="w-28 px-3 py-2 text-right font-medium">총 재고</th>
                {warehouseNames.map((warehouseName) => (
                  <th key={warehouseName} className="w-28 whitespace-nowrap px-3 py-2 text-right font-medium">
                    {warehouseName}
                  </th>
                ))}
                <th className="w-28 px-3 py-2 text-right font-medium">가용 재고</th>
                <th className="w-40 px-3 py-2 font-medium">최근 입고</th>
                <th className="w-40 px-3 py-2 font-medium">최근 중국출고요청</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                    <td colSpan={6 + warehouseNames.length} className="px-3 py-12 text-center text-sm text-muted-foreground">
                    조건에 맞는 중국창고 재고가 없습니다.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{item.sku}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.productName}</div>
                      <div className="text-xs text-muted-foreground">{item.optionName || '-'}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.totalQuantity.toLocaleString('ko-KR')}
                    </td>
                    {warehouseNames.map((warehouseName) => (
                      <td key={warehouseName} className="px-3 py-2 text-right tabular-nums">
                        {(item.warehouseQuantities[warehouseName] ?? 0).toLocaleString('ko-KR')}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.availableQuantity.toLocaleString('ko-KR')}
                    </td>
                    <td className="px-3 py-2">{formatDateTime(item.lastArrivedAt)}</td>
                    <td className="px-3 py-2">{formatDateTime(item.lastOutboundRequestedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {totalPages > 1 ? (
        <nav className="flex w-full items-center justify-between gap-2 sm:justify-end">
          <Button
            render={<Link href={pageHref({ page: Math.max(1, page - 1), search })} />}
            variant="outline"
            disabled={page <= 1}
          >
            이전
          </Button>
          <span className="text-sm text-muted-foreground">
            {page.toLocaleString('ko-KR')} / {totalPages.toLocaleString('ko-KR')}
          </span>
          <Button
            render={<Link href={pageHref({ page: Math.min(totalPages, page + 1), search })} />}
            variant="outline"
            disabled={page >= totalPages}
          >
            다음
          </Button>
        </nav>
      ) : null}
    </div>
  )
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function pageHref({ page, search }: { page: number; search?: string }) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/purchasing/china-inventory?${query}` : '/purchasing/china-inventory'
}

function formatDateTime(value: string | Date | null) {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(date)
}

function MobileStockMetric({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="px-2 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${emphasis ? 'text-emerald-700' : ''}`}>{value.toLocaleString('ko-KR')}개</dd>
    </div>
  )
}
