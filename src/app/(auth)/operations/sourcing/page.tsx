import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Search } from 'lucide-react'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { getWorkspaceUserId, listAdmins } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import { getNewProductViewer, listNewProductOperators } from '@/lib/new-products/workflow'
import { listSourcingMeetings } from '@/lib/operations/sourcing'
import { SourcingBoard } from './sourcing-board'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '소싱',
}

export default async function SourcingPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [meetings, operators, viewer, exchangeRate, accounts] = await Promise.all([
    listSourcingMeetings({ userId: workspaceUserId, actorUserId: user.id }),
    listNewProductOperators(workspaceUserId),
    getNewProductViewer({ userId: workspaceUserId, actorUserId: user.id }),
    getLatestCnyKrwReferenceRate(),
    listAdmins(),
  ])

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Search className="h-6 w-6" />
          소싱
        </h1>
        <p className="text-sm text-muted-foreground">
          수요일 소싱회의를 날짜별로 만들고, 등록자별 입력 시트에서 여러 상품을 한 번에 관리합니다.
        </p>
      </header>

      <ProductFlowNav />

      <SourcingBoard
        meetings={meetings}
        operators={operators.filter((operator) => operator.isActive)}
        viewer={viewer}
        exchangeRate={exchangeRate}
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
