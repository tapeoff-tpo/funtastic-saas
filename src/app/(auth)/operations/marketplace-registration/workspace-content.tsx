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
  if (params.row) await assertMenuAccess('/analytics/price-table')
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1)
  const data = await listPriceTableRows({
    userId: workspaceId, page, search: query, exactProductCode: exactSku,
    sheetName: '상품등록', sortKey: 'createdAt', sortOrder: 'desc',
  })
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize))
  function href(targetPage: number, row?: string) {
    const search = new URLSearchParams()
    if (targetPage > 1) search.set('page', String(targetPage))
    if (query) search.set('q', query)
    if (row) search.set('row', row)
    return search.size ? `/operations/marketplace-registration?${search}` : '/operations/marketplace-registration'
  }
  if (page > pageCount) redirect(href(pageCount, params.row))
  return <div className="space-y-3">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">상품등록</h1>
      <Link href="/analytics/price-table" className="text-sm text-primary underline">판매가 테이블</Link>
    </header>
    <form className="flex max-w-xl gap-2">
      <input name="q" defaultValue={query} aria-label="상품명·SKU·등록번호 검색" placeholder="상품명·SKU·등록번호 검색"
        className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm" />
      <button className="rounded-md border px-3 py-1.5 text-sm">검색</button>
    </form>
    <div className="grid gap-3 lg:h-[calc(100dvh-16rem)] lg:min-h-96 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section aria-label="상품 목록" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border">
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">총 {data.total.toLocaleString('ko-KR')}개 · 최근 품목 등록순</div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup><col className="w-28" /><col /><col className="w-32" /></colgroup>
            <thead className="sticky top-0 z-10 bg-muted"><tr><th className="p-2">상품코드</th><th className="p-2">상품명</th><th className="p-2">옵션</th></tr></thead>
            <tbody>{data.rows.map((row) => {
              const name = row.registeredProductName || row.productName || row.productCode || ''
              return <tr key={row.id} className={`border-t ${params.row === row.id ? 'bg-primary/10' : 'hover:bg-muted/30'}`}>
                <td className="p-2 font-mono text-xs"><Link href={href(page, row.id)} scroll={false} prefetch={false} title={row.productCode ?? ''} className="block truncate">{row.productCode}</Link></td>
                <td className="p-2"><Link href={href(page, row.id)} scroll={false} prefetch={false}
                  aria-current={params.row === row.id ? 'true' : undefined} title={name} className="block truncate text-primary hover:underline">{name}</Link></td>
                <td className="p-2 text-xs text-muted-foreground"><Link href={href(page, row.id)} scroll={false} prefetch={false} title={row.optionName ?? ''} className="block truncate">{row.optionName}</Link></td>
              </tr>
            })}{data.rows.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-muted-foreground">조회된 상품이 없습니다.</td></tr>}</tbody>
          </table>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-3 border-t p-2 text-sm">
          {page > 1 && <Link href={href(page - 1, params.row)} scroll={false} prefetch={false} className="rounded-md border px-3 py-1">이전</Link>}
          <span>{page} / {pageCount}</span>
          {page < pageCount && <Link href={href(page + 1, params.row)} scroll={false} prefetch={false} className="rounded-md border px-3 py-1">다음</Link>}
        </div>
      </section>
      <aside aria-label="상품 상세" className="min-h-0 min-w-0 overflow-y-auto rounded-md border bg-card p-3">
        {params.row ? <>
          <div className="mb-3 flex justify-end"><Link href={href(page)} scroll={false} className="text-xs text-muted-foreground underline">상세 닫기</Link></div>
          <LinkedPriceRegistration embedded listPage={page} userId={workspaceId} rowId={params.row} mallId={params.mall}
            search={query} view={params.view === 'products' ? 'products' : 'compare'} malls={(params.malls ?? '').split(',').filter(Boolean)} />
        </> : <p className="p-6 text-center text-sm text-muted-foreground">왼쪽 목록에서 상품을 선택하세요.</p>}
      </aside>
    </div>
  </div>
}
