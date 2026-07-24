import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { ESA009M_HEADERS, getPurchasingItems } from '@/lib/purchasing/items'
import { CostsPageClient } from './costs-page-client'

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
      <CostsPageClient
        headers={ESA009M_HEADERS}
        rows={items.map((item) => ({
          id: item.id,
          data: item.data,
          purchaseUrlVerificationStatus: item.purchaseUrlVerificationStatus,
          updatedAt: item.updatedAt.toISOString(),
        }))}
        total={total}
        page={page}
        pageCount={pageCount}
        search={search}
      />
    </div>
  )
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
