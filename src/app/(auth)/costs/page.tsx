import { createSearchParamsCache, parseAsInteger, parseAsString } from 'nuqs/server'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getProducts } from '@/lib/products/queries'
import type { ProductFilters } from '@/lib/products/types'
import { CostsClient, type CostRow } from './costs-client'
import { ProductCostUpload } from '@/components/product-cost-upload'

const SORT_KEYS = new Set(['internalSku', 'name', 'costPrice', 'warehouseLocation'])

const searchParamsCache = createSearchParamsCache({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(50),
  search: parseAsString,
  sort: parseAsString,
  order: parseAsString,
})

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParamsCache.parse(searchParams)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const sort = params.sort && SORT_KEYS.has(params.sort) ? params.sort : 'internalSku'
  const order = params.order === 'desc' ? 'desc' : 'asc'

  const filters: ProductFilters = {
    page: params.page,
    pageSize: params.pageSize,
    search: params.search?.trim() || undefined,
    sort,
    order,
  }

  const { items, total } = await getProducts(workspaceUserId, filters)
  const rows: CostRow[] = items.map((item) => ({
    id: item.id,
    internalSku: item.internalSku,
    name: item.name,
    costPrice: item.costPrice ?? null,
    warehouseLocation: item.warehouseLocation ?? null,
  }))

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">품목</h1>
          <p className="text-sm text-muted-foreground">
            보유 품목의 상품코드, 상품명, 원가, 위치 정보를 관리합니다.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          전체 {total.toLocaleString('ko-KR')}개
        </p>
      </header>

      <ProductCostUpload />
      <CostsClient
        rows={rows}
        total={total}
        page={params.page}
        pageSize={params.pageSize}
      />
    </div>
  )
}
