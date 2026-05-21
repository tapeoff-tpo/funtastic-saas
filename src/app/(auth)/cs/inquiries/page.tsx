import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { CsCollectPanel } from '@/components/cs/cs-collect-panel'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCsTickets, type CsFilters, type CsTicket } from '@/lib/cs/queries'
import { CsWorkbench, type SerializableCsTicket } from '../cs-workbench'

export const metadata: Metadata = {
  title: '문의',
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

export default async function CsInquiriesPage({
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
    source: 'inquiry',
    workstream: (asString(params.workstream) as CsFilters['workstream']) || 'all',
    marketplace: asString(params.marketplace),
    status: asString(params.status),
    search: asString(params.search),
    page: Number.isFinite(page) ? page : 1,
    pageSize: 25,
  }

  const result = await getCsTickets(workspaceUserId, filters)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <CsCollectPanel
          buttonLabel="API 문의 수집"
          runningLabel="API 수집 중..."
          scope="inquiries"
          method="api"
          lookbackDays={7}
          compact
        />
        <CsCollectPanel
          buttonLabel="RPA 문의 수집"
          runningLabel="RPA 수집 중..."
          scope="inquiries"
          method="rpa"
          lookbackDays={7}
          compact
        />
      </div>
      <CsWorkbench
        tickets={result.tickets.map(serializeTicket)}
        stats={result.stats}
        total={result.total}
        marketplaces={result.marketplaces}
        page={filters.page ?? 1}
        pageSize={filters.pageSize ?? 25}
        basePath="/cs/inquiries"
        fixedSource="inquiry"
        title="문의"
        description="마켓 1:1문의와 고객문의 게시판에서 수집한 미답변 문의를 확인합니다."
        showBarcodeLookup={false}
        showInspectionTools={false}
        filters={{
          source: 'inquiry',
          workstream: filters.workstream ?? 'all',
          marketplace: filters.marketplace ?? '',
          status: filters.status ?? '',
          search: filters.search ?? '',
        }}
      />
    </div>
  )
}
