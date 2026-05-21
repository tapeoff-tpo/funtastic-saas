import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { AlertCircle, MessageSquareText } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWorkspaceUserId } from '@/lib/admin-accounts/queries'
import { getUnansweredInquiries } from '@/lib/cs/queries'

export const metadata: Metadata = {
  title: '문의 관리',
}

const INQUIRY_TYPE_LABELS: Record<string, string> = {
  product: '상품 문의',
  callcenter: '콜센터',
  online: '온라인 문의',
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default async function CsInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const page = params.page ? Number(params.page) : 1
  const workspaceUserId = await getWorkspaceUserId(user.id)
  const { inquiries, total } = await getUnansweredInquiries(workspaceUserId, page, 50)
  const totalPages = Math.max(1, Math.ceil(total / 50))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">문의 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">미답변 {total.toLocaleString('ko-KR')}건</p>
        </div>
        <Link href="/cs" className="inline-flex h-9 items-center rounded-md border bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
          CS 대시보드
        </Link>
      </div>

      <section className="rounded-md border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500">
              <tr>
                <th className="w-32 px-4 py-2">요청일</th>
                <th className="w-32 px-4 py-2">마켓</th>
                <th className="w-32 px-4 py-2">유형</th>
                <th className="px-4 py-2">문의</th>
                <th className="w-40 px-4 py-2">주문</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {inquiries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-500">
                    미답변 문의가 없습니다.
                  </td>
                </tr>
              ) : (
                inquiries.map((inquiry) => (
                  <tr key={inquiry.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{formatDate(inquiry.requestedAt)}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{inquiry.marketplaceId}</td>
                    <td className="px-4 py-3 text-gray-600">{INQUIRY_TYPE_LABELS[inquiry.inquiryType] ?? inquiry.inquiryType}</td>
                    <td className="max-w-[480px] px-4 py-3">
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

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {page > 1 && (
            <Link href={`/cs/inquiries?page=${page - 1}`} className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
              이전
            </Link>
          )}
          <span className="rounded-md border bg-white px-3 py-1.5 text-sm text-gray-600">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link href={`/cs/inquiries?page=${page + 1}`} className="rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-gray-50">
              다음
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
