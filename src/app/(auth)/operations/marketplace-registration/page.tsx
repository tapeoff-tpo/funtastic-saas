import { redirect } from 'next/navigation'
import { ClipboardPenLine, Database, Layers3 } from 'lucide-react'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCurrentUser } from '@/lib/auth/current-user'
import { listMarketplaceRegistrationProducts } from '@/lib/operations/marketplace-registration'
import { RegistrationBoard } from './registration-board'

export const dynamic = 'force-dynamic'

export default async function MarketplaceRegistrationPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const rows = await listMarketplaceRegistrationProducts(await getWorkspaceUserId(user.id))
  const optionCount = rows.reduce((total, row) => total + row.options.length, 0)
  const matchedCodeCount = rows.reduce((total, row) => total + row.matchedSalesCodes, 0)
  const lastSyncedAt = rows.find((row) => row.lastSyncedAt)?.lastSyncedAt

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ClipboardPenLine className="size-6" />
            상품 등록 관리
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Funtastic B2B 상품을 기준으로 옵션과 이미지를 불러오고, 몰별 등록에 필요한 정보만 보완합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Database className="size-4" /> 상품 {rows.length.toLocaleString('ko-KR')}개</span>
          <span className="inline-flex items-center gap-1.5"><Layers3 className="size-4" /> 옵션 {optionCount.toLocaleString('ko-KR')}개</span>
          <span>판매코드 매칭 {matchedCodeCount.toLocaleString('ko-KR')}개</span>
          <span>최근 동기화 {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('ko-KR') : '없음'}</span>
        </div>
      </header>
      <RegistrationBoard rows={rows} />
    </div>
  )
}
