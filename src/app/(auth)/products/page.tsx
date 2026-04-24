import { Suspense } from 'react'
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

export const metadata: Metadata = {
  title: '상품 관리',
}

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(50),
  status: parseAsString,
  category: parseAsString,
  search: parseAsString,
  sort: parseAsString,
  order: parseAsString,
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

  const filters: ProductFiltersParams = {
    page: params.page,
    pageSize: params.pageSize,
    status: (params.status ?? undefined) as ProductFiltersParams['status'],
    categoryId: params.category ?? undefined,
    search: params.search ?? undefined,
    sort: params.sort ?? undefined,
    order: (params.order as 'asc' | 'desc') ?? undefined,
  }

  const { items, total } = await getProducts(user.id, filters)

  const data: ProductRow[] = items.map((item) => ({
    id: item.id,
    internalSku: item.internalSku,
    name: item.name,
    categoryId: item.categoryId,
    basePrice: item.basePrice,
    costPrice: item.costPrice ?? null,
    warehouseLocation: item.warehouseLocation ?? null,
    defaultCarrierId: item.defaultCarrierId ?? null,
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
          <a
            href="/products/new"
            className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
          >
            상품등록
          </a>
        </div>
      </div>

      {/* Filters */}
      <Suspense>
        <ProductFilters />
      </Suspense>

      {/* Data Table */}
      <ProductDataTable
        data={data}
        total={total}
        page={params.page}
        pageSize={params.pageSize}
      />
    </div>
  )
}
