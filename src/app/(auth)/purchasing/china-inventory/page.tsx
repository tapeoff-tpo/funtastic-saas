import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
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
  const { items, total } = await getChinaWarehouseInventory({
    userId: workspaceUserId,
    search: search ?? undefined,
    page,
    pageSize: 50,
  })
  const totalPages = Math.max(1, Math.ceil(total / 50))

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">중국재고</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            발주 항목이 중국창고도착으로 이동하면 입고되고, 출고요청으로 이동하면 차감됩니다.
          </p>
        </div>
        <form className="flex items-center gap-2" action="/purchasing/china-inventory">
          <input
            name="search"
            defaultValue={search ?? ''}
            placeholder="품목코드, 상품명, 옵션"
            className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <Button type="submit" variant="outline">검색</Button>
        </form>
      </header>

      <section className="overflow-hidden rounded-md border bg-background">
        <div className="flex flex-col gap-1 border-b px-3 py-2">
          <h2 className="text-sm font-semibold">중국창고 재고 목록</h2>
          <p className="text-xs text-muted-foreground">총 {total.toLocaleString('ko-KR')}건</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="w-32 px-3 py-2 font-medium">품목코드</th>
                <th className="px-3 py-2 font-medium">상품</th>
                <th className="w-28 px-3 py-2 text-right font-medium">총 재고</th>
                <th className="w-28 px-3 py-2 text-right font-medium">가용 재고</th>
                <th className="w-40 px-3 py-2 font-medium">최근 입고</th>
                <th className="w-40 px-3 py-2 font-medium">최근 출고요청</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-sm text-muted-foreground">
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
        <nav className="flex items-center justify-end gap-2">
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
