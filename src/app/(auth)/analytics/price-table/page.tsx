import type { Metadata } from 'next'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { listPriceTableRows, type PriceTableRow } from '@/lib/analytics/price-table'
import { getCurrentUser } from '@/lib/auth/current-user'
import { PriceTableUpload } from './price-table-upload'

export const metadata: Metadata = {
  title: '판매가 테이블',
}

export default async function PriceTablePage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; q?: string; sheet?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) return null

  const params = await searchParams
  const page = Math.max(1, Number.parseInt(params?.page ?? '1', 10) || 1)
  const search = params?.q?.trim() ?? ''
  const sheetName = params?.sheet?.trim() ?? ''
  const workspaceUserId = await getWorkspaceUserId(user.id)

  const data = await listPriceTableRows({
    userId: workspaceUserId,
    page,
    search,
    sheetName,
  }).catch((error) => {
    console.error('price table list error:', error)
    return { rows: [], total: 0, page, pageSize: 100, sheets: [], latestImport: null }
  })

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">판매가 테이블</h1>
          <p className="text-sm text-muted-foreground">
            등록 상품의 상품코드, 상품명, 등록상품명, 플랫폼별 판매가 원본 데이터를 분석합니다.
          </p>
        </div>
        <Link href="/analytics" className="w-fit rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
          매출분석으로
        </Link>
      </div>

      <PriceTableUpload />

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="전체 행" value={data.total.toLocaleString('ko-KR')} />
        <SummaryCard label="시트" value={data.sheets.length.toLocaleString('ko-KR')} />
        <SummaryCard label="최근 업로드" value={formatDateTime(data.latestImport)} />
      </div>

      <form className="grid gap-2 rounded-lg border bg-card p-4 md:grid-cols-[180px_1fr_auto]">
        <select name="sheet" defaultValue={sheetName} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">전체 시트</option>
          {data.sheets.map((sheet) => (
            <option key={sheet} value={sheet}>{sheet}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            defaultValue={search}
            placeholder="상품코드, 상품명, 등록상품명, 플랫폼 가격 원본 검색"
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm"
          />
        </div>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          검색
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">시트</th>
                <th className="px-3 py-2 font-medium">상품코드</th>
                <th className="px-3 py-2 font-medium">상품명</th>
                <th className="px-3 py-2 font-medium">옵션</th>
                <th className="px-3 py-2 font-medium">등록상품명</th>
                <th className="px-3 py-2 font-medium">주요 가격/배송비</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                    업로드된 판매가 테이블 데이터가 없습니다.
                  </td>
                </tr>
              ) : data.rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{row.sourceSheetName}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{row.productCode ?? '-'}</td>
                  <td className="max-w-[220px] px-3 py-2">{row.productName ?? '-'}</td>
                  <td className="max-w-[180px] px-3 py-2 text-muted-foreground">{row.optionName ?? '-'}</td>
                  <td className="max-w-[300px] px-3 py-2">{row.registeredProductName ?? '-'}</td>
                  <td className="px-3 py-2">
                    <PricePreview row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="text-muted-foreground">
          {data.total.toLocaleString('ko-KR')}건 중 {data.rows.length.toLocaleString('ko-KR')}건 표시
        </div>
        <div className="flex items-center gap-2">
          <PageLink page={page - 1} disabled={page <= 1} search={search} sheetName={sheetName}>이전</PageLink>
          <span className="text-muted-foreground">{page} / {totalPages}</span>
          <PageLink page={page + 1} disabled={page >= totalPages} search={search} sheetName={sheetName}>다음</PageLink>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  )
}

function PricePreview({ row }: { row: PriceTableRow }) {
  const entries = Object.entries(row.rawData ?? {})
    .filter(([key, value]) => value && /(판매가|가격|금액|배송비|원가|추가금|수수료|정산)/.test(key))
    .slice(0, 8)

  if (entries.length === 0) return <span className="text-muted-foreground">-</span>

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span key={`${row.id}-${key}`} className="rounded-md border bg-background px-2 py-1 text-xs">
          <span className="text-muted-foreground">{key}</span>
          <span className="ml-1 font-medium">{String(value)}</span>
        </span>
      ))}
    </div>
  )
}

function PageLink({
  page,
  disabled,
  search,
  sheetName,
  children,
}: {
  page: number
  disabled: boolean
  search: string
  sheetName: string
  children: React.ReactNode
}) {
  if (disabled) {
    return <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">{children}</span>
  }
  const params = new URLSearchParams()
  if (page > 1) params.set('page', String(page))
  if (search) params.set('q', search)
  if (sheetName) params.set('sheet', sheetName)
  const href = params.size ? `/analytics/price-table?${params}` : '/analytics/price-table'
  return <Link href={href} className="rounded-md border bg-background px-3 py-1.5 hover:bg-muted">{children}</Link>
}

function formatDateTime(value: Date | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(value)
}
