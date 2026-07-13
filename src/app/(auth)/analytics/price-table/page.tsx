import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronDown, FileSpreadsheet, Search, X } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { listPriceTableRows } from '@/lib/analytics/price-table'
import { getCurrentUser } from '@/lib/auth/current-user'
import { PriceTableGrid, type PriceTableGridRow } from './price-table-grid'
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
  }>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const params = await searchParams
  const page = Math.max(1, Number.parseInt(params?.page ?? '1', 10) || 1)
  const search = params?.q?.trim() ?? ''
  const activeSheet = params?.sheet?.trim() || '상품등록'
  const sortKey = params?.sort?.trim() || 'productCode'
  const sortOrder = params?.order === 'desc' ? 'desc' : 'asc'
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
  const sheetCounts = [...data.sheetCounts].sort((left, right) => (
    SHEET_ORDER.indexOf(left.name) - SHEET_ORDER.indexOf(right.name)
  ))
  const gridRows: PriceTableGridRow[] = data.rows.map((row) => ({
    id: row.id,
    rowNumber: row.rowNumber,
    productCode: row.productCode,
    productName: row.productName,
    optionName: row.optionName,
    registeredProductName: row.registeredProductName,
    rawData: row.rawData as Record<string, string>,
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">판매가 테이블</h1>
          <p className="text-sm text-muted-foreground">
            상품별 판매가와 배송비를 플랫폼 단위로 비교합니다.
          </p>
        </div>
        <Link href="/analytics" className="w-fit rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
          매출분석으로
        </Link>
      </div>

      <div className="grid overflow-hidden rounded-md border bg-card sm:grid-cols-3 sm:divide-x">
        <SummaryItem label="전체 데이터" value={`${data.overallTotal.toLocaleString('ko-KR')}건`} />
        <SummaryItem
          label={search ? '검색 결과' : `${activeSheet} 데이터`}
          value={`${data.total.toLocaleString('ko-KR')}건`}
        />
        <SummaryItem label="최근 업로드" value={formatDateTime(data.latestImport)} />
      </div>

      <details className="group rounded-md border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">원본 파일 교체</span>
            {data.sourceFileName ? <span className="truncate text-xs text-muted-foreground">{data.sourceFileName}</span> : null}
          </div>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t p-4">
          <PriceTableUpload />
        </div>
      </details>

      <section className="overflow-hidden rounded-md border bg-card">
        <div className="flex gap-1 overflow-x-auto border-b px-3 pt-1">
          {sheetCounts.map((sheet) => (
            <Link
              key={sheet.name}
              href={sheetHref(sheet.name, search)}
              className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium ${
                activeSheet === sheet.name
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {sheet.name}
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums">
                {sheet.count.toLocaleString('ko-KR')}
              </span>
            </Link>
          ))}
        </div>

        <form className="flex flex-col gap-2 p-3 sm:flex-row">
          <input type="hidden" name="sheet" value={activeSheet} />
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              defaultValue={search}
              placeholder="상품코드, 상품명, 등록상품명, 플랫폼 값 검색"
              className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            검색
          </button>
          {search ? (
            <Link
              href={`/analytics/price-table?sheet=${encodeURIComponent(activeSheet)}`}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
              초기화
            </Link>
          ) : null}
        </form>
      </section>

      <PriceTableGrid
        key={activeSheet}
        rows={gridRows}
        sheetName={activeSheet}
        sortKey={sortKey}
        sortOrder={sortOrder}
      />

      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-muted-foreground">
          {data.total.toLocaleString('ko-KR')}건 중 {data.rows.length.toLocaleString('ko-KR')}건 표시
        </div>
        <div className="flex items-center gap-2">
          <PageLink
            page={page - 1}
            disabled={page <= 1}
            search={search}
            sheetName={activeSheet}
            sortKey={sortKey}
            sortOrder={sortOrder}
          >
            이전
          </PageLink>
          <span className="min-w-[70px] text-center text-muted-foreground">{page} / {totalPages}</span>
          <PageLink
            page={page + 1}
            disabled={page >= totalPages}
            search={search}
            sheetName={activeSheet}
            sortKey={sortKey}
            sortOrder={sortOrder}
          >
            다음
          </PageLink>
        </div>
      </div>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b px-4 py-3 last:border-b-0 sm:border-b-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function PageLink({
  page,
  disabled,
  search,
  sheetName,
  sortKey,
  sortOrder,
  children,
}: {
  page: number
  disabled: boolean
  search: string
  sheetName: string
  sortKey: string
  sortOrder: 'asc' | 'desc'
  children: React.ReactNode
}) {
  if (disabled) {
    return <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">{children}</span>
  }
  const params = new URLSearchParams()
  if (page > 1) params.set('page', String(page))
  if (search) params.set('q', search)
  params.set('sheet', sheetName)
  if (sortKey !== 'productCode') params.set('sort', sortKey)
  if (sortOrder !== 'asc') params.set('order', sortOrder)
  return (
    <Link href={`/analytics/price-table?${params}`} className="rounded-md border bg-background px-3 py-1.5 hover:bg-muted">
      {children}
    </Link>
  )
}

function sheetHref(sheetName: string, search: string) {
  const params = new URLSearchParams({ sheet: sheetName })
  if (search) params.set('q', search)
  return `/analytics/price-table?${params}`
}

function formatDateTime(value: Date | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(value)
}
