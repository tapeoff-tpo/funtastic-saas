import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, desc, eq, ilike, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { products } from '@/lib/db/schema'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { PRODUCT_OPERATIONS_PATH, PRODUCT_OPERATIONS_TABS, productOperationsHref } from '@/lib/operations/product-operations'
import InventoryPage from '../../inventory/workspace-content'
import CostsPage from '../../costs/workspace-content'
import PriceTablePage from '../../analytics/price-table/workspace-content'
import DetailPagesPage from '../detail-pages/page'
import MarketplaceRegistrationPage from '../marketplace-registration/workspace-content'

export const metadata = { title: '상품 운영' }

function readParam(value: string | string[] | undefined) {
  return (typeof value === 'string' ? value.trim() : '').slice(0, 200)
}

export default async function ProductOperationsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const access = await getUserMenuAccess(user.id)
  if (!access) redirect('/access-denied')
  const tabs = PRODUCT_OPERATIONS_TABS.filter((tab) => tab.menus.some((menu) => canUseMenu(access, menu)))
  const params = await searchParams
  const tab = tabs.find((candidate) => candidate.id === params.tab) ?? tabs[0]
  if (!tab) redirect('/access-denied')

  const sku = readParam(params.sku)
  const search = readParam(params.product)
  const workspaceId = await getWorkspaceUserId(user.id)
  const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`
  const [selection, candidates] = await Promise.all([
    sku ? db.select({ id: products.id, sku: products.internalSku, name: products.name, metadata: products.metadata })
      .from(products).where(and(eq(products.userId, workspaceId), eq(products.internalSku, sku))).limit(1) : [],
    !sku || search ? db.select({ sku: products.internalSku, name: products.name })
      .from(products).where(and(eq(products.userId, workspaceId), search
        ? or(ilike(products.internalSku, term), ilike(products.name, term)) : undefined))
      .orderBy(desc(products.createdAt), desc(products.id)).limit(20) : [],
  ])
  const selected = selection[0]
  const master = selected?.metadata?.esa009m as Record<string, unknown> | undefined
  const field = (key: string) => typeof master?.[key] === 'string' ? String(master[key]) : ''

  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">상품 운영</h1>
        {selected && <p className="text-sm">{selected.name} · <span className="font-mono">{selected.sku}</span></p>}
      </div>
      <form action={PRODUCT_OPERATIONS_PATH} className="flex gap-2">
        <input type="hidden" name="tab" value={tab.id} />
        <input type="search" name="product" aria-label="상품명 또는 SKU" placeholder="상품명 또는 SKU" defaultValue={search}
          className="min-w-0 rounded-md border bg-background px-3 py-1.5 text-sm" />
        <button className="rounded-md border px-3 py-1.5 text-sm">상품 검색</button>
      </form>
    </header>
    {!selected && <section aria-label="상품 선택" className="divide-y rounded-md border">
      {candidates.length ? candidates.map((candidate) => <Link key={candidate.sku} prefetch={false}
        href={productOperationsHref(tab.id, candidate.sku)} className="flex gap-3 px-3 py-2 text-sm hover:bg-muted">
        <span className="font-mono text-muted-foreground">{candidate.sku}</span><span>{candidate.name}</span>
      </Link>) : <p className="p-3 text-sm text-muted-foreground">조회된 상품이 없습니다.</p>}
    </section>}
    {selected && <>
      <nav aria-label="상품 운영 탭" className="flex flex-wrap gap-1 border-b">
        {tabs.map((candidate) => <Link key={candidate.id} href={productOperationsHref(candidate.id, selected.sku)}
          prefetch={false} aria-current={tab.id === candidate.id ? 'page' : undefined}
          className="border-b-2 border-transparent px-3 py-2 text-sm aria-[current=page]:border-primary aria-[current=page]:font-semibold">
          {candidate.label}
        </Link>)}
      </nav>
      <div className="flex flex-wrap gap-3 text-sm">
        {tab.menus.filter((menu) => canUseMenu(access, menu)).map((menu) => {
          const query = menu === '/inventory' ? { search: sku, searched: '1' }
            : menu === '/costs' ? { search: sku }
            : menu === '/operations/detail-pages' ? { sku, itemId: selected.id, name: selected.name }
            : { q: sku }
          const label = menu === '/costs' ? '품목리스트' : menu === '/analytics/price-table' ? '판매가 테이블' : tab.label
          return <Link key={menu} href={{ pathname: menu, query }} prefetch={false}
            className="text-primary underline underline-offset-4">{label} 전체 화면</Link>
        })}
      </div>
      {tab.id === 'inventory' && <InventoryPage exactSku={sku} searchParams={Promise.resolve({ searched: '1' })} />}
      {tab.id === 'pricing' && <>
        {canUseMenu(access, '/costs') && <CostsPage exactSku={sku} searchParams={Promise.resolve({})} />}
        {canUseMenu(access, '/analytics/price-table') && <PriceTablePage exactProductCode={sku} searchParams={Promise.resolve({})} />}
      </>}
      {tab.id === 'detail' && <DetailPagesPage searchParams={Promise.resolve({
        itemId: selected.id, sku, name: selected.name, purchaseUrl: field('구매 URL'), option: field('규격정보'),
        material: field('재질'), manufacturer: field('제조사'), country: field('제조국'),
      })} />}
      {tab.id === 'registration' && <MarketplaceRegistrationPage exactSku={sku} searchParams={Promise.resolve({ q: sku })} />}
    </>}
  </div>
}
