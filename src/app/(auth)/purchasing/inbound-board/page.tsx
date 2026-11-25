import { getCurrentUser } from '@/lib/auth/current-user'
import { getUserMenuAccess } from '@/lib/auth/menu-access'
import { canUseMenu } from '@/lib/auth/menu-permissions'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { listBoardCategories } from '@/lib/purchasing/board-notices'
import { Suspense } from 'react'
import { InboundBoardWorkspace } from './inbound-board-panel'

export const metadata = { title: '게시판' }

export default async function InboundBoardPage() {
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) return null
  const access = await getUserMenuAccess(user.id, user)
  if (!access || !canUseMenu(access, '/purchasing/import-documents')) return null
  const owner = await getWorkspaceUserId(user.id)
  const categories = await listBoardCategories(owner).catch((error) => {
    console.error('Board categories:', error)
    return []
  })
  return <div className="min-w-0 space-y-4">
    <h1 className="text-2xl font-semibold">게시판</h1>
    <Suspense fallback={<p role="status">입고리스트 불러오는 중…</p>}>
      <InboundBoardWorkspace initialCategories={categories} />
    </Suspense>
  </div>
}
