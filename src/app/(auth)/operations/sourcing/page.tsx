import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Search } from 'lucide-react'
import { ProductFlowNav } from '@/components/product-flow-nav'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import { getNewProductViewer, listNewProductOperators } from '@/lib/new-products/workflow'
import { listManualSourcingItems } from '@/lib/operations/sourcing'
import { SourcingBoard } from './sourcing-board'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '소싱',
}

export default async function SourcingPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [items, operators, viewer, exchangeRate] = await Promise.all([
    listManualSourcingItems({ userId: workspaceUserId, actorUserId: user.id }),
    listNewProductOperators(workspaceUserId),
    getNewProductViewer({ userId: workspaceUserId, actorUserId: user.id }),
    getLatestCnyKrwReferenceRate(),
  ])

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Search className="h-6 w-6" />
          소싱
        </h1>
        <p className="text-sm text-muted-foreground">
          자동 수집 없이 상품을 직접 등록하고, 1차 통과한 상품은 신상품 진행관리로 보냅니다.
        </p>
      </header>

      <ProductFlowNav />

      <SourcingBoard
        items={items}
        operators={operators.filter((operator) => operator.isActive)}
        viewer={viewer}
        exchangeRate={exchangeRate}
      />
    </div>
  )
}
