import { Suspense } from 'react'
import Link from 'next/link'
import {
  createSearchParamsCache,
  parseAsString,
  parseAsInteger,
} from 'nuqs/server'
import { createClient } from '@/lib/supabase/server'
import { getProducts } from '@/lib/products/queries'
import { ProductDataTable } from './data-table'
import { ProductFilters } from './filters'
import { CarrierBulkActions } from './carrier-bulk-actions'
import type { ProductRow } from './columns'
import type { ProductFilters as ProductFiltersParams } from '@/lib/products/types'
import type { Metadata } from 'next'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'

export const metadata: Metadata = {
  title: '상품 관리',
}

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(25),
  status: parseAsString,
  category: parseAsString,
  inventory: parseAsString,
  search: parseAsString,
  sort: parseAsString,
  order: parseAsString,
  // 검색 트리거 sentinel — 이게 없으면 페이지 진입 직후엔 fetch 하지 않는다.
  searched: parseAsString,
})

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParamsCache.parse(searchParams)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const filters: ProductFiltersParams = {
    page: params.page,
    pageSize: params.pageSize,
    status: (params.status ?? undefined) as ProductFiltersParams['status'],
    categoryId: params.category ?? undefined,
    manageInventory: params.inventory === 'managed' ? true : undefined,
    search: params.search ?? undefined,
    sort: params.sort ?? undefined,
    order: (params.order as 'asc' | 'desc') ?? undefined,
  }

  // 검색 버튼 누르기 전엔 fetch 하지 않음. searched sentinel 이 켜졌을 때만 조회.
  const searched = !!params.searched
  const { items, total } = searched
    ? await getProducts(workspaceUserId, filters)
    : { items: [] as Awaited<ReturnType<typeof getProducts>>['items'], total: 0 }

  const data: ProductRow[] = items.map((item) => ({
    id: item.id,
    internalSku: item.internalSku,
    name: item.name,
    optionName: item.optionName ?? null,
    categoryId: item.categoryId,
    basePrice: item.basePrice,
    costPrice: item.costPrice ?? null,
    warehouseLocation: item.warehouseLocation ?? null,
    defaultCarrierId: item.defaultCarrierId ?? null,
    manageInventory: item.manageInventory,
    status: item.status,
    variantCount: item.variantCount,
    updatedAt: item.updatedAt,
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">상품 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            전체 {total.toLocaleString('ko-KR')}개 상품
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/inventory"
            className="rounded-md border bg-green-50 border-green-300 px-3 py-1.5 text-sm text-green-700 hover:bg-green-100"
          >
            재고관리에서 일괄 등록
          </a>
          <CarrierBulkActions />
          <a
            href="/api/products/export"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            엑셀 내보내기
          </a>
          <Link
            href="/products/new"
            className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
          >
            상품등록
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Suspense>
        <ProductFilters />
      </Suspense>

      {/* Data Table — 검색 전엔 안내, 후엔 결과 */}
      {!searched ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          검색 조건을 입력하고 <span className="font-medium text-foreground">검색</span> 버튼을 눌러주세요.
        </div>
      ) : (
        <ProductDataTable
          data={data}
          total={total}
          page={params.page}
          pageSize={params.pageSize}
        />
      )}
    </div>
  )
}
