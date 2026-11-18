import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { listPriceTableRows } from '@/lib/analytics/price-table'
import { LinkedPriceRegistration } from './linked-price-registration'
import { assertMenuAccess } from '@/lib/auth/menu-access'

export const dynamic = 'force-dynamic'

export default async function MarketplaceRegistrationPage({
  searchParams, exactSku,
}: {
  exactSku?: string
  searchParams: Promise<{ q?: string; row?: string; mall?: string; view?: string; malls?: string; page?: string }>
}) {
  await assertMenuAccess('/operations/marketplace-registration')
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const params = await searchParams
  const query = params.q?.trim() ?? ''
  const workspaceId = await getWorkspaceUserId(user.id)
  if (params.row) {
    await assertMenuAccess('/analytics/price-table')
    return <LinkedPriceRegistration userId={workspaceId} rowId={params.row} mallId={params.mall}
      search={query} view={params.view === 'products' ? 'products' : 'compare'} malls={(params.malls ?? '').split(',').filter(Boolean)} />
  }
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1)
  const data = await listPriceTableRows({
    userId: workspaceId, page, search: query, exactProductCode: exactSku,
    sheetName: '상품등록', sortKey: 'createdAt', sortOrder: 'desc',
  })
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize))
  const listHref = (targetPage: number) => {
    const search = new URLSearchParams({ page: String(targetPage) })
    if (query) search.set('q', query)
    return `/operations/marketplace-registration?${search}`
  }
  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-xl font-semibold">상품등록</h1>
      <Link href="/analytics/price-table" className="text-sm text-primary underline">판매가 테이블</Link>
    </header>
    <form className="flex max-w-xl gap-2">
      <input name="q" defaultValue={query} aria-label="상품명·SKU·등록번호 검색" placeholder="상품명·SKU·등록번호 검색"
        className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" />
      <button className="rounded-md border px-3 py-2 text-sm">검색</button>
    </form>
    <p className="text-sm text-muted-foreground">총 {data.total.toLocaleString('ko-KR')}개 · 상품을 선택해 몰별 등록번호와 상품정보를 확인하세요.</p>
    <div className="overflow-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted"><tr><th className="p-3">상품코드</th><th className="p-3">상품명</th><th className="p-3">옵션</th><th className="p-3">등록번호 관리</th></tr></thead>
        <tbody>{data.rows.map((row) => {
          const params = new URLSearchParams({ row: row.id })
          if (query) params.set('q', query)
          const href = `/operations/marketplace-registration?${params}`
          return <tr key={row.id} className="border-t hover:bg-muted/30">
            <td className="p-3 font-mono">{row.productCode}</td>
            <td className="p-3"><Link href={href} prefetch={false} className="text-primary hover:underline">{row.registeredProductName || row.productName || row.productCode}</Link></td>
            <td className="p-3 text-muted-foreground">{row.optionName}</td>
            <td className="p-3"><Link href={href} prefetch={false} className="whitespace-nowrap rounded-md border px-2 py-1">번호 관리</Link></td>
          </tr>
        })}{data.rows.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">조회된 상품이 없습니다.</td></tr>}</tbody>
      </table>
    </div>
    <div className="flex items-center justify-end gap-3 text-sm">
      {page > 1 && <Link href={listHref(page - 1)} prefetch={false} className="rounded-md border px-3 py-1.5">이전</Link>}
      <span>{page} / {pageCount}</span>
      {page < pageCount && <Link href={listHref(page + 1)} prefetch={false} className="rounded-md border px-3 py-1.5">다음</Link>}
    </div>
  </div>
}
