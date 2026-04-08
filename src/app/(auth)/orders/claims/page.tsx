import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getClaims } from '@/lib/orders/claims-queries'
import { ClaimsTable } from './claims-table'
import type { Metadata } from 'next'
import type { ClaimType, ClaimStatus } from '@/lib/orders/types'

export const metadata: Metadata = {
  title: '클레임 관리',
}

const CLAIM_TYPE_TABS: { label: string; value: ClaimType | '' }[] = [
  { label: '전체', value: '' },
  { label: '취소', value: 'cancel' },
  { label: '반품', value: 'return' },
  { label: '교환', value: 'exchange' },
]

const CLAIM_STATUS_TABS: { label: string; value: ClaimStatus | '' }[] = [
  { label: '전체', value: '' },
  { label: '접수', value: 'requested' },
  { label: '처리중', value: 'processing' },
  { label: '완료', value: 'completed' },
  { label: '반려', value: 'rejected' },
]

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const params = await searchParams
  const claimType = (params.claimType as ClaimType | undefined) ?? undefined
  const claimStatus = (params.claimStatus as ClaimStatus | undefined) ?? undefined
  const page = params.page ? Number(params.page) : 1

  const { claims, total } = await getClaims(user.id, {
    claimType: claimType || undefined,
    claimStatus: claimStatus || undefined,
    page,
    pageSize: 50,
  })

  // Build filter URL helpers
  function filterUrl(key: string, value: string) {
    const sp = new URLSearchParams()
    if (key !== 'claimType' && claimType) sp.set('claimType', claimType)
    if (key !== 'claimStatus' && claimStatus) sp.set('claimStatus', claimStatus)
    if (value) sp.set(key, value)
    sp.delete('page')
    const qs = sp.toString()
    return `/orders/claims${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">클레임 관리</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          전체 {total.toLocaleString('ko-KR')}건의 클레임
        </p>
      </div>

      {/* Claim type filter */}
      <div className="flex gap-2 border-b">
        {CLAIM_TYPE_TABS.map((tab) => {
          const isActive = (claimType ?? '') === tab.value
          return (
            <Link
              key={tab.value || 'all-type'}
              href={filterUrl('claimType', tab.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Claim status filter */}
      <div className="flex gap-2 flex-wrap">
        {CLAIM_STATUS_TABS.map((tab) => {
          const isActive = (claimStatus ?? '') === tab.value
          return (
            <Link
              key={tab.value || 'all-status'}
              href={filterUrl('claimStatus', tab.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Claims table */}
      <ClaimsTable claims={claims} total={total} page={page} pageSize={50} />
    </div>
  )
}
