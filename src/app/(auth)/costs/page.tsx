import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { ESA009M_HEADERS, getPurchasingItems } from '@/lib/purchasing/items'
import { PurchasingItemUpload } from '@/components/purchasing-item-upload'

export const metadata: Metadata = { title: '諛쒖＜ ?덈ぉ' }

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(single(params.page)) || 1)
  const pageSize = 50
  const search = single(params.search)?.trim() || undefined
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { items, total } = await getPurchasingItems({
    userId: await getWorkspaceUserId(user.id),
    page,
    pageSize,
    search,
  })
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">품목</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ESA009M 전체 항목 · {total.toLocaleString('ko-KR')}개 품목
          </p>
        </div>
        <PurchasingItemUpload />
      </div>

      <form className="flex max-w-xl gap-2">
        <input name="search" defaultValue={search} placeholder="품목코드, 품목명, 영문명, HS CODE 검색" className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" />
        <button className="h-9 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted">검색</button>
      </form>

      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-max text-sm">
          <thead className="sticky top-0 z-[1] bg-muted">
            <tr className="border-b">
              {ESA009M_HEADERS.map((header) => (
                <th key={header} className="whitespace-nowrap px-3 py-2.5 text-left font-medium">{header}</th>
              ))}
              <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">당월 출고수량</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">3개월 평균 출고수량</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left font-medium">최근 반영일</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={ESA009M_HEADERS.length + 3} className="h-40 text-center text-muted-foreground">
                  표시할 품목이 없습니다. ESA009M 엑셀을 업로드해주세요.
                </td>
              </tr>
            ) : items.map((item) => (
              <tr key={item.id} className="border-b hover:bg-muted/40">
                {ESA009M_HEADERS.map((header) => (
                  <td key={header} className={`max-w-80 px-3 py-2 align-top ${header === ESA009M_HEADERS[1] ? 'whitespace-normal' : 'whitespace-nowrap'}`} title={item.data[header] ?? undefined}>
                    {item.data[header] || '-'}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{item.outgoingMetrics.currentMonthOutgoing.toLocaleString('ko-KR')}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{item.outgoingMetrics.threeMonthAverageOutgoing.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{item.updatedAt.toLocaleString('ko-KR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{page} / {pageCount} 페이지</span>
        <div className="flex gap-2">
          <PageLink disabled={page <= 1} href={pageHref(page - 1, search)}>이전</PageLink>
          <PageLink disabled={page >= pageCount} href={pageHref(page + 1, search)}>다음</PageLink>
        </div>
      </div>
    </div>
  )
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) return <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-50">{children}</span>
  return <Link href={href} className="rounded-md border px-3 py-1.5 hover:bg-muted">{children}</Link>
}

function pageHref(page: number, search?: string) {
  const params = new URLSearchParams({ page: String(page) })
  if (search) params.set('search', search)
  return `/costs?${params}`
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
