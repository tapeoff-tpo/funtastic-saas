import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getRegistrationCatalog } from '@/lib/operations/registration-groups'
import { getManualRegistrationTargets } from '../../analytics/price-table/price-table-columns'
import { RegistrationFilters, RegistrationProductLink } from './catalog-controls'
import { LinkedPriceRegistration } from './linked-price-registration'
import { assertMenuAccess } from '@/lib/auth/menu-access'

export const dynamic = 'force-dynamic'

export default async function MarketplaceRegistrationPage({
  searchParams, exactSku,
}: {
  exactSku?: string
  searchParams: Promise<{ q?: string; row?: string; mall?: string; view?: string; malls?: string; page?: string; status?: string; missingMalls?: string; missingMatch?: string; group?: string }>
}) {
  await assertMenuAccess('/operations/marketplace-registration')
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const params = await searchParams
  const query = params.q?.trim() ?? ''
  const workspaceId = await getWorkspaceUserId(user.id)
  if (params.row) await assertMenuAccess('/analytics/price-table')
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1)
  const catalog = await getRegistrationCatalog(workspaceId)
  const targets = getManualRegistrationTargets('상품등록')
  const selectedMalls = (params.missingMalls ?? '').split(',').filter((id) => targets.some((target) => target.id === id))
  const status = params.status === 'missing' || params.status === 'complete' ? params.status : 'all'
  const missingMatch = params.missingMatch === 'all' ? 'all' : 'any'
  const term = query.toLocaleLowerCase('ko-KR')
  const matching = catalog.filter((group) => {
    if (exactSku && !group.skus.has(exactSku)) return false
    if (term && ![group.code, group.name, ...group.skus, ...group.rows.flatMap((row) =>
      [row.productName ?? '', row.optionName ?? '', ...Object.values(row.rawData).map(String)])]
      .some((value) => value.toLocaleLowerCase('ko-KR').includes(term))) return false
    if (status === 'missing' && !group.missingMalls.length) return false
    if (status === 'complete' && group.missingMalls.length) return false
    if (!selectedMalls.length) return true
    return missingMatch === 'all' ? selectedMalls.every((id) => group.missingMalls.includes(id))
      : selectedMalls.some((id) => group.missingMalls.includes(id))
  })
  const pageCount = Math.max(1, Math.ceil(matching.length / 50))
  const visible = matching.slice((page - 1) * 50, page * 50)
  const selectedGroup = catalog.find((group) => group.rows.some((row) => row.id === params.row))?.key ?? params.group
  function href(targetPage: number, row?: string) {
    const search = new URLSearchParams()
    if (targetPage > 1) search.set('page', String(targetPage))
    if (query) search.set('q', query)
    if (status !== 'all') search.set('status', status)
    if (selectedMalls.length) search.set('missingMalls', selectedMalls.join(','))
    if (selectedMalls.length > 1) search.set('missingMatch', missingMatch)
    if (row) search.set('row', row)
    if (params.group) search.set('group', params.group)
    return search.size ? `/operations/marketplace-registration?${search}` : '/operations/marketplace-registration'
  }
  if (page > pageCount) redirect(href(pageCount, params.row))
  return <div className="space-y-3">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">상품등록</h1>
      <Link href="/analytics/price-table" className="text-sm text-primary underline">판매가 테이블</Link>
    </header>
    <RegistrationFilters key={`${query}:${status}:${missingMatch}:${selectedMalls.join(',')}`} query={query} status={status}
      missingMalls={selectedMalls} match={missingMatch} targets={targets.map(({ id, label }) => ({ id, label }))} />
    <div className="grid gap-3 lg:h-[calc(100dvh-18rem)] lg:min-h-96 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section aria-label="상품 목록" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border">
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">총 {matching.length.toLocaleString('ko-KR')}개 상품 · 최근 품목 등록순</div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup><col className="w-28" /><col /><col className="w-16" /><col className="w-20" /></colgroup>
            <thead className="sticky top-0 z-10 bg-muted"><tr><th className="p-2">상품코드</th><th className="p-2">상품명</th><th className="p-2">옵션</th><th className="p-2">미등록</th></tr></thead>
            <tbody>{visible.map((group) => <tr key={group.key}
              className={`border-t ${selectedGroup === group.key ? 'bg-primary/10' : 'hover:bg-muted/30'}`}>
              <td className="truncate p-2 font-mono text-xs" title={group.code}>{group.code}</td>
              <td className="p-2"><RegistrationProductLink rowId={group.rowId} sku={group.sku} label={group.name}
                href={href(page, group.rowId ?? undefined)} selected={selectedGroup === group.key} /></td>
              <td className="p-2 text-center text-xs tabular-nums text-muted-foreground">{group.optionCount}개</td>
              <td className="p-2 text-center text-xs tabular-nums">{group.missingMalls.length ? `${group.missingMalls.length}개 몰` : '등록완료'}</td>
            </tr>)}{visible.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">조회된 상품이 없습니다.</td></tr>}</tbody>
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
