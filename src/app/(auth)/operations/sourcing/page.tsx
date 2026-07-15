import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Search } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { listSourcingBoard, SOURCING_STATUS_LABELS } from '@/lib/operations/sourcing'
import { SourcingBoard } from './sourcing-board'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '소싱',
}

export default async function SourcingPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const items = await listSourcingBoard(workspaceUserId)

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Search className="h-6 w-6" />
          소싱
        </h1>
        <p className="text-sm text-muted-foreground">
          쿠팡에서 확인한 상품과 1688 후보를 내부 검토용으로 기록합니다.
        </p>
      </header>

      <SourcingBoard
        items={items.map((item) => ({
          id: item.id,
          sourcePlatform: item.sourcePlatform,
          sourceTitle: item.sourceTitle,
          sourceUrl: item.sourceUrl,
          imageUrl: item.imageUrl,
          category: item.category,
          sourceRank: item.sourceRank,
          sourcePrice: item.sourcePrice,
          keyword: item.keyword,
          status: item.status,
          selected1688Url: item.selected1688Url,
          selectedAt: item.selectedAt?.toISOString() ?? null,
          memo: item.memo,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          candidates: item.candidates.map((candidate) => ({
            id: candidate.id,
            itemId: candidate.itemId,
            platform: candidate.platform,
            title: candidate.title,
            candidateUrl: candidate.candidateUrl,
            imageUrl: candidate.imageUrl,
            priceText: candidate.priceText,
            supplierName: candidate.supplierName,
            matchScore: candidate.matchScore,
            isSelected: candidate.isSelected,
            memo: candidate.memo,
            createdAt: candidate.createdAt.toISOString(),
          })),
        }))}
        statusLabels={SOURCING_STATUS_LABELS}
      />
    </div>
  )
}
