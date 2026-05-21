import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getClaims } from '@/lib/orders/claims-queries'
import { ClaimsTable } from '@/app/(auth)/orders/claims/claims-table'
import type { ClaimType } from '@/lib/orders/types'

const TYPE_LABELS: Record<ClaimType, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
}

export async function CsClaimPage({
  claimType,
  page,
}: {
  claimType: ClaimType
  page: number
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const { claims, total } = await getClaims(workspaceUserId, {
    claimType,
    page,
    pageSize: 50,
  })
  const label = TYPE_LABELS[claimType]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{label} 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">전체 {total.toLocaleString('ko-KR')}건</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/cs" className="inline-flex h-9 items-center rounded-md border bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
            CS 대시보드
          </Link>
          <Link href={`/orders/claims?claimType=${claimType}`} className="inline-flex h-9 items-center rounded-md border bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
            전체 클레임
          </Link>
        </div>
      </div>

      <ClaimsTable claims={claims} total={total} page={page} pageSize={50} />
    </div>
  )
}
