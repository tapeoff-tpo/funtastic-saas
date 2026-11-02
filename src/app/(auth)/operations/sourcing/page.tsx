import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Search } from 'lucide-react'
import { getWorkspaceUserId, listAdmins } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import type { CnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import { getSourcingViewer, listSourcingMeetings, listSourcingOperators } from '@/lib/operations/sourcing'
import { SourcingBoard } from './sourcing-board'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '소싱',
}

const SOURCING_DEFAULT_EXCHANGE_RATE: CnyKrwReferenceRate = {
  rate: 250,
  date: null,
  source: 'fallback',
}

export default async function SourcingPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [meetings, operators, viewer, accounts] = await Promise.all([
    listSourcingMeetings({ userId: workspaceUserId, actorUserId: user.id }),
    listSourcingOperators(workspaceUserId),
    getSourcingViewer({ userId: workspaceUserId, actorUserId: user.id }),
    listAdmins(),
  ])

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Search className="h-6 w-6" />
          소싱
        </h1>
      </header>

      <SourcingBoard
        meetings={meetings}
        operators={operators}
        viewer={viewer}
        exchangeRate={SOURCING_DEFAULT_EXCHANGE_RATE}
        availableMembers={accounts
          .filter((account) => !account.deactivatedAt)
          .map((account) => ({
            id: account.id,
            displayName: account.displayName?.trim() || account.email,
          }))}
      />
    </div>
  )
}
