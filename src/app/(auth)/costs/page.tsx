import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { ESA009M_HEADERS, getPurchasingItems } from '@/lib/purchasing/items'
import { PurchasingItemUpload } from '@/components/purchasing-item-upload'
import { PurchasingUrlCollector } from '@/components/purchasing-url-collector'
import { CostsEditableTable } from './costs-editable-table'

export const metadata: Metadata = { title: '품목' }

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
        <div className="flex flex-wrap items-start justify-end gap-2">
          <PurchasingUrlCollector />
          <PurchasingItemUpload />
        </div>
      </div>

      <form className="flex max-w-xl gap-2">
        <input
          name="search"
          defaultValue={search}
          placeholder="품목코드, 품목명, 영문명, HS CODE 검색"
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
        />
        <button className="h-9 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted">
          검색
        </button>
      </form>

      <CostsEditableTable
        headers={ESA009M_HEADERS}
        rows={items.map((item) => ({
          id: item.id,
          data: item.data,
          purchaseUrlVerificationStatus: item.purchaseUrlVerificationStatus,
          updatedAt: item.updatedAt.toISOString(),
        }))}
      />

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
