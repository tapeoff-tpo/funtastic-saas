import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { AlertCircle, ArrowRight, MessageSquareText, RotateCcw, Undo2, XCircle } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getCsOverview } from '@/lib/cs/queries'
import { CsCollectPanel } from '@/components/cs/cs-collect-panel'
import type { ClaimStatus, ClaimType } from '@/lib/orders/types'

export const metadata: Metadata = {
  title: 'CS 관리',
}

const CLAIM_TYPE_LINKS: Array<{
  type: ClaimType
  label: string
  icon: typeof XCircle
  className: string
}> = [
  { type: 'cancel', label: '취소 요청', icon: XCircle, className: 'bg-red-50 text-red-700 ring-red-100' },
  { type: 'return', label: '반품 요청', icon: Undo2, className: 'bg-amber-50 text-amber-700 ring-amber-100' },
  { type: 'exchange', label: '교환 요청', icon: RotateCcw, className: 'bg-blue-50 text-blue-700 ring-blue-100' },
]

const STATUS_LABELS: Record<ClaimStatus, string> = {
  requested: '접수',
  processing: '처리중',
  completed: '완료',
  rejected: '반려',
}

const INQUIRY_TYPE_LABELS: Record<string, string> = {
  product: '상품 문의',
  callcenter: '콜센터',
  online: '온라인 문의',
}

function StatItem({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'red' | 'amber' | 'blue'
}) {
  const toneClass = {
    default: 'border-gray-200 bg-white text-gray-900',
    red: 'border-red-100 bg-red-50 text-red-800',
    amber: 'border-amber-100 bg-amber-50 text-amber-800',
    blue: 'border-blue-100 bg-blue-50 text-blue-800',
  }[tone]

  return (
    <div className={`rounded-md border px-4 py-3 ${toneClass}`}>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString('ko-KR')}</div>
    </div>
  )
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default async function CsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const workspaceUserId = await getWorkspaceUserId(user.id)
  const overview = await getCsOverview(workspaceUserId)
  const needsAttention = overview.claimsByStatus.requested + overview.claimsByStatus.processing + overview.unansweredInquiries

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">CS 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">클레임 {overview.totalClaims.toLocaleString('ko-KR')}건</p>
        </div>
        <Link
          href="/orders/claims"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          클레임 목록
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatItem label="처리 필요" value={needsAttention} tone="red" />
        <StatItem label="클레임 접수" value={overview.claimsByStatus.requested} tone="amber" />
        <StatItem label="처리중" value={overview.claimsByStatus.processing} tone="blue" />
        <StatItem label="미답변 문의" value={overview.unansweredInquiries} />
      </div>

      <CsCollectPanel />

      <section className="rounded-md border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">요청 유형</h2>
        </div>
        <div className="grid gap-px bg-gray-200 sm:grid-cols-3">
          {CLAIM_TYPE_LINKS.map((item) => {
            const Icon = item.icon
            const count = overview.claimsByType[item.type]
            return (
              <Link
                key={item.type}
                href={`/orders/claims?claimType=${item.type}&claimStatus=requested`}
                className="flex items-center justify-between bg-white px-4 py-4 hover:bg-gray-50"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md ring-1 ${item.className}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {item.label}
                </span>
                <span className="text-xl font-semibold tabular-nums text-gray-900">{count.toLocaleString('ko-KR')}</span>
              </Link>
            )
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <section className="rounded-md border bg-white">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">클레임 상태</h2>
          </div>
          <div className="divide-y">
            {(Object.keys(STATUS_LABELS) as ClaimStatus[]).map((status) => (
              <Link
                key={status}
                href={`/orders/claims?claimStatus=${status}`}
                className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50"
              >
                <span className="text-gray-600">{STATUS_LABELS[status]}</span>
                <span className="font-semibold tabular-nums text-gray-900">
                  {overview.claimsByStatus[status].toLocaleString('ko-KR')}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-md border bg-white">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">미답변 문의</h2>
            <span className="text-xs font-medium text-gray-500">{overview.unansweredInquiries.toLocaleString('ko-KR')}건</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500">
                <tr>
                  <th className="w-32 px-4 py-2">요청일</th>
                  <th className="w-32 px-4 py-2">마켓</th>
                  <th className="w-32 px-4 py-2">유형</th>
                  <th className="px-4 py-2">문의</th>
                  <th className="w-36 px-4 py-2">주문</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {overview.recentUnansweredInquiries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                      미답변 문의가 없습니다.
                    </td>
                  </tr>
                ) : (
                  overview.recentUnansweredInquiries.map((inquiry) => (
                    <tr key={inquiry.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{formatDate(inquiry.requestedAt)}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{inquiry.marketplaceId}</td>
                      <td className="px-4 py-3 text-gray-600">{INQUIRY_TYPE_LABELS[inquiry.inquiryType] ?? inquiry.inquiryType}</td>
                      <td className="max-w-[420px] px-4 py-3">
                        <div className="flex items-start gap-2">
                          <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                          <span className="line-clamp-2 text-gray-800">{inquiry.question}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {inquiry.orderId ? (
                          <Link href={`/orders/${inquiry.orderId}`} className="font-medium text-blue-600 hover:underline">
                            {inquiry.marketplaceOrderId ?? '주문 상세'}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <AlertCircle className="h-3.5 w-3.5" />
                            미연결
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
