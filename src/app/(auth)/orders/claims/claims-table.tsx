'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateClaimStatus, updateClaimMemo } from '@/lib/orders/claims-actions'
import type { ClaimWithOrder } from '@/lib/orders/claims-queries'
import type { ClaimStatus } from '@/lib/orders/types'

interface ClaimsTableProps {
  claims: ClaimWithOrder[]
  total: number
  page: number
  pageSize: number
}

const CLAIM_TYPE_LABELS: Record<string, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
}

const CLAIM_TYPE_STYLES: Record<string, string> = {
  cancel: 'bg-gray-100 text-gray-700',
  return: 'bg-amber-100 text-amber-700',
  exchange: 'bg-blue-100 text-blue-700',
}

const CLAIM_STATUS_LABELS: Record<string, string> = {
  requested: '접수',
  processing: '처리중',
  completed: '완료',
  rejected: '반려',
}

const CLAIM_STATUS_STYLES: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

function ClaimRow({ claim }: { claim: ClaimWithOrder }) {
  const [memo, setMemo] = useState(claim.reason ?? '')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleStatusUpdate(status: ClaimStatus) {
    startTransition(async () => {
      await updateClaimStatus(claim.id, status)
      router.refresh()
    })
  }

  function handleMemoBlur() {
    const trimmed = memo.trim()
    if (trimmed === (claim.reason ?? '').trim()) return
    startTransition(async () => {
      await updateClaimMemo(claim.id, trimmed)
    })
  }

  const requestedAt = new Date(claim.requestedAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return (
    <tr className="border-b hover:bg-gray-50">
      {/* 마켓 */}
      <td className="px-3 py-3 text-sm text-gray-700">{claim.marketplaceId}</td>

      {/* 주문번호 */}
      <td className="px-3 py-3 text-sm font-mono text-gray-600 max-w-[140px] truncate">
        {claim.marketplaceOrderId}
      </td>

      {/* 구매자 */}
      <td className="px-3 py-3 text-sm">{claim.buyerName}</td>

      {/* 상품명 */}
      <td className="px-3 py-3 text-sm text-gray-700 max-w-[180px] truncate">
        {claim.productName ?? '-'}
      </td>

      {/* 클레임유형 */}
      <td className="px-3 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            CLAIM_TYPE_STYLES[claim.claimType] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {CLAIM_TYPE_LABELS[claim.claimType] ?? claim.claimType}
        </span>
      </td>

      {/* 상태 */}
      <td className="px-3 py-3">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
            CLAIM_STATUS_STYLES[claim.claimStatus] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {CLAIM_STATUS_LABELS[claim.claimStatus] ?? claim.claimStatus}
        </span>
      </td>

      {/* 접수일 */}
      <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">{requestedAt}</td>

      {/* 사유/메모 */}
      <td className="px-3 py-3">
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onBlur={handleMemoBlur}
          disabled={isPending}
          rows={2}
          placeholder="메모 입력..."
          className="w-full min-w-[140px] resize-none rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-blue-400 focus:outline-none disabled:opacity-50"
        />
      </td>

      {/* 액션 */}
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1">
          {claim.claimStatus !== 'processing' && (
            <button
              type="button"
              onClick={() => handleStatusUpdate('processing')}
              disabled={isPending}
              className="rounded px-2 py-1 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
            >
              처리중
            </button>
          )}
          {claim.claimStatus !== 'completed' && (
            <button
              type="button"
              onClick={() => handleStatusUpdate('completed')}
              disabled={isPending}
              className="rounded px-2 py-1 text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 whitespace-nowrap"
            >
              완료
            </button>
          )}
          {claim.claimStatus !== 'rejected' && (
            <button
              type="button"
              onClick={() => handleStatusUpdate('rejected')}
              disabled={isPending}
              className="rounded px-2 py-1 text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
            >
              반려
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

export function ClaimsTable({ claims, total, page, pageSize }: ClaimsTableProps) {
  const router = useRouter()
  const totalPages = Math.ceil(total / pageSize)

  if (claims.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-gray-400">
        클레임이 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-full text-left">
          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-3">마켓</th>
              <th className="px-3 py-3">마켓 주문번호</th>
              <th className="px-3 py-3">구매자</th>
              <th className="px-3 py-3">상품명</th>
              <th className="px-3 py-3">클레임유형</th>
              <th className="px-3 py-3">상태</th>
              <th className="px-3 py-3">접수일</th>
              <th className="px-3 py-3">사유/메모</th>
              <th className="px-3 py-3">액션</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {claims.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            {((page - 1) * pageSize + 1).toLocaleString('ko-KR')}–
            {Math.min(page * pageSize, total).toLocaleString('ko-KR')} / {total.toLocaleString('ko-KR')}건
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const sp = new URLSearchParams(window.location.search)
                sp.set('page', String(page - 1))
                router.push(`/orders/claims?${sp.toString()}`)
              }}
              disabled={page <= 1}
              className="rounded border px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
            >
              이전
            </button>
            <span className="px-2 py-1">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => {
                const sp = new URLSearchParams(window.location.search)
                sp.set('page', String(page + 1))
                router.push(`/orders/claims?${sp.toString()}`)
              }}
              disabled={page >= totalPages}
              className="rounded border px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
