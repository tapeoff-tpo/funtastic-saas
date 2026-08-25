import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getLatestCnyKrwReferenceRate } from '@/lib/new-products/cny-cost'
import { getNewProductPageSetup } from '@/lib/new-products/workflow'
import { NewProductBoard } from './new-product-board'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '신상품 진행관리',
}

export default async function NewProductsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const [setup, exchangeRate] = await Promise.all([
    getNewProductPageSetup({ userId: workspaceUserId, actorUserId: user.id }),
    getLatestCnyKrwReferenceRate(),
  ])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-6 w-6 text-violet-600" />
          신상품 진행관리
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          1차 통과부터 등록 완료까지, 상품별 정보와 샘플·품질표시 자료를 한곳에서 관리합니다.
        </p>
      </header>
      <NewProductBoard
        initialStages={setup.stages}
        initialLayout={setup.editorLayout}
    canManageSettings={setup.viewer.isMain}
        exchangeRate={exchangeRate}
      />
    </div>
  )
}
