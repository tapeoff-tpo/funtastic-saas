import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCsTickets, type CsFilters, type CsTicket } from '@/lib/cs/queries'
import { CsWorkbench, type SerializableCsTicket } from './cs-workbench'

export const metadata: Metadata = {
  title: 'CS 작업함',
}

function asString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function serializeTicket(ticket: CsTicket): SerializableCsTicket {
  return {
    ...ticket,
    requestedAt: ticket.requestedAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  }
}

export default async function CsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const params = await searchParams
  const page = Number(asString(params.page) ?? '1')

  const filters: CsFilters = {
    source: (asString(params.source) as CsFilters['source']) || 'all',
    workstream: (asString(params.workstream) as CsFilters['workstream']) || 'all',
    marketplace: asString(params.marketplace),
    status: asString(params.status),
    search: asString(params.search),
    page: Number.isFinite(page) ? page : 1,
    pageSize: 25,
  }

  const result = await getCsTickets(workspaceUserId, filters)

  return (
    <CsWorkbench
      tickets={result.tickets.map(serializeTicket)}
      stats={result.stats}
      total={result.total}
      marketplaces={result.marketplaces}
      page={filters.page ?? 1}
      pageSize={filters.pageSize ?? 25}
      filters={{
        source: filters.source ?? 'all',
        workstream: filters.workstream ?? 'all',
        marketplace: filters.marketplace ?? '',
        status: filters.status ?? '',
        search: filters.search ?? '',
      }}
    />
  )
}
