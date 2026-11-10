import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { formatPriceNumberDate } from '@/lib/analytics/price-number-date'
import { listPriceTableRows } from '@/lib/analytics/price-table'
import { getCurrentUser } from '@/lib/auth/current-user'
import { type PriceTableGridRow } from './price-table-grid'
import { getPriceTableSourceNumber } from './price-table-columns'
import { priceTableHref, priceTablePages, type PriceTableNavigation } from './price-table-navigation'
import { PriceTableWorkspace } from './price-table-workspace'
import { ChannelBundleOverridesUpload } from './channel-bundle-overrides-upload'
import { PriceQueuePanel } from '@/components/product-linking/price-queue-panel'
import { ManualPriceProduct } from './manual-price-product'
import { PriceTableUpload } from './price-table-upload'

export const metadata: Metadata = {
  title: '판매가 테이블',
}

const SHEET_ORDER = ['상품등록', '메인', '뉴도매']

export default async function PriceTablePage({
  searchParams,
}: {
  searchParams?: Promise<{
    page?: string
    q?: string
    sheet?: string
    sort?: string
    order?: string
    view?: string
  }>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const params = await searchParams
  const page = Math.max(1, Number.parseInt(params?.page ?? '1', 10) || 1)
  const search = params?.q?.trim() ?? ''
  const activeSheet = params?.sheet?.trim() || '상품등록'
  const sortKey = params?.sort?.trim() || 'importedAt'
  const sortOrder = params?.order === 'asc' ? 'asc' : 'desc'
  const activeView = params?.view === 'products' ? 'products' : 'compare'
  const navigation: PriceTableNavigation = { sheetName: activeSheet, search, sortKey, sortOrder, view: activeView }
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const data = await listPriceTableRows({
    userId: workspaceUserId,
    page,
    search,
    sheetName: activeSheet,
    sortKey,
    sortOrder,
  }).catch((error) => {
    console.error('price table list error:', error)
    return {
      rows: [],
      total: 0,
      overallTotal: 0,
      page,
      pageSize: 100,
      sheets: [],
      sheetCounts: [],
      latestImport: null,
      sourceFileName: null,
    }
  })

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))
  if (page > totalPages) redirect(priceTableHref({ ...navigation, page: totalPages }))
  const sheetCounts = [...data.sheetCounts].sort((left, right) => (
    SHEET_ORDER.indexOf(left.name) - SHEET_ORDER.indexOf(right.name)
  ))
  const gridRows: PriceTableGridRow[] = data.rows.map((row) => ({
    id: row.id,
    rowNumber: row.rowNumber,
    sourceNumber: getPriceTableSourceNumber(row.sourceSheetName, row.rawData),
    productCode: row.productCode,
    productName: row.productName,
    optionName: row.optionName,
    registeredProductName: row.registeredProductName,
    rawData: row.rawData as Record<string, string>,
    directEntryDate: row.sourceFileName === '직접 등록' ? formatPriceNumberDate(row.importedAt) : undefined,
  }))
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">판매가 테이블</h1>
        </div>
        <div className="flex w-fit gap-2">
          <Link href="/operations/marketplace-registration" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            상품 등록 관리로
          </Link>
          <Link href="/analytics" className="rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
            매출분석으로
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5">
        <div className="flex items-center gap-1" aria-label="원본 시트">
          {sheetCounts.map(sheet => <Link key={sheet.name} href={priceTableHref({ ...navigation, sheetName: sheet.name })} className={`rounded px-2 py-1 text-xs font-medium ${activeSheet === sheet.name ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{sheet.name} <span className="tabular-nums opacity-75">{sheet.count.toLocaleString('ko-KR')}</span></Link>)}
        </div>
        <form className="flex min-w-0 flex-1 items-center gap-1 sm:max-w-md">
          <input type="hidden" name="sheet" value={activeSheet} />
          <input type="hidden" name="view" value={activeView} />
          <input type="hidden" name="sort" value={sortKey} />
          <input type="hidden" name="order" value={sortOrder} />
          <input aria-label="판매가 상품 검색" name="q" defaultValue={search} placeholder="상품코드 · 상품명 · 등록번호 검색" className="h-8 min-w-0 flex-1 rounded border bg-background px-2 text-xs" />
          <button type="submit" aria-label="검색" className="inline-flex size-8 items-center justify-center rounded border hover:bg-muted"><Search className="size-3.5" /></button>
          {search && <Link aria-label="검색 초기화" href={priceTableHref({ ...navigation, search: '' })} className="inline-flex size-8 items-center justify-center rounded border"><X className="size-3.5" /></Link>}
        </form>
        <PriceQueuePanel />
        <details className="group relative ml-auto">
          <summary className="cursor-pointer list-none rounded border px-2 py-1.5 text-xs [&::-webkit-details-marker]:hidden">등록·업로드 ▾</summary>
          <div className="absolute right-0 z-40 mt-1 max-h-[75vh] w-[min(900px,calc(100vw-2rem))] space-y-3 overflow-auto rounded-md border bg-popover p-3 shadow-lg">
            <ManualPriceProduct sheetName={activeSheet} />
            <ChannelBundleOverridesUpload />
            <details className="rounded border p-2"><summary className="cursor-pointer text-sm font-medium">원본 엑셀 업로드</summary><div className="pt-3"><PriceTableUpload compact /></div></details>
          </div>
        </details>
        <details className="relative">
          <summary className="cursor-pointer list-none px-2 py-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">데이터 정보 ⓘ</summary>
          <div className="absolute right-0 z-30 mt-1 w-64 space-y-2 rounded-md border bg-popover p-3 text-xs shadow-lg"><SummaryItem label="전체" value={`${data.overallTotal.toLocaleString('ko-KR')}건`} /><SummaryItem label="최근 업로드" value={formatDateTime(data.latestImport)} /><p className="text-muted-foreground">최근 추가 순 · 같은 파일 내 원본 행 순서</p></div>
        </details>
      </div>

      <PriceTableWorkspace
        key={activeSheet}
        rows={gridRows}
        navigation={navigation}
        page={page}
      />

      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-muted-foreground">
          {data.total.toLocaleString('ko-KR')}건 중 {data.rows.length.toLocaleString('ko-KR')}건 표시
        </div>
        <nav aria-label="판매가 테이블 페이지" className="flex flex-wrap items-center gap-1 sm:justify-end">
          <PageLink page={1} disabled={page === 1} label="처음 페이지" navigation={navigation}>처음</PageLink>
          <PageLink page={Math.max(1, page - 10)} disabled={page === 1} label="10페이지 이전" navigation={navigation}>{'<<'}</PageLink>
          <PageLink page={page - 1} disabled={page === 1} label="이전 페이지" navigation={navigation}>{'‹'}</PageLink>
          {priceTablePages(page, totalPages).map((target) => (
            <PageLink key={target} page={target} current={target === page} label={`${target}페이지`} navigation={navigation}>{target}</PageLink>
          ))}
          <PageLink page={page + 1} disabled={page === totalPages} label="다음 페이지" navigation={navigation}>{'›'}</PageLink>
          <PageLink page={Math.min(totalPages, page + 10)} disabled={page === totalPages} label="10페이지 다음" navigation={navigation}>{'>>'}</PageLink>
          <PageLink page={totalPages} disabled={page === totalPages} label="마지막 페이지" navigation={navigation}>마지막</PageLink>
        </nav>
      </div>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span>{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function PageLink({ page, disabled, current, label, navigation, children }: {
  page: number
  disabled?: boolean
  current?: boolean
  label: string
  navigation: PriceTableNavigation
  children: React.ReactNode
}) {
  const style = 'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-1.5 text-xs tabular-nums'
  if (current) return <span aria-label={label} aria-current="page" className={`${style} bg-primary text-primary-foreground`}>{children}</span>
  if (disabled) return <span aria-label={label} aria-disabled="true" className={`${style} text-muted-foreground opacity-50`}>{children}</span>
  return (
    <Link aria-label={label} href={priceTableHref({ ...navigation, page })} prefetch={false} className={`${style} bg-background hover:bg-muted`}>
      {children}
    </Link>
  )
}

function formatDateTime(value: Date | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(value)
}
