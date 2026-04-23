'use client'

import Link from 'next/link'

interface WorkflowDiagramProps {
  counts: {
    new: number          // 신규
    confirmed: number    // 주문확인
    preparing: number    // 출고대기
    shipped: number      // 출고완료
    cancelled: number    // 취소
    returned: number     // 반품
    exchanged: number    // 교환
    held: number         // 미발송
  }
}

interface NodeProps {
  label: string
  count: number
  href: string
  variant?: 'primary' | 'warn' | 'danger' | 'success' | 'neutral'
  active?: boolean
}

const VARIANT_STYLES: Record<NonNullable<NodeProps['variant']>, string> = {
  primary: 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100',
  warn: 'bg-orange-50 border-orange-300 text-orange-700 hover:bg-orange-100',
  danger: 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100',
  success: 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100',
  neutral: 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100',
}

function Node({ label, count, href, variant = 'neutral', active = false }: NodeProps) {
  return (
    <Link
      href={href}
      className={`inline-flex flex-col items-center gap-0.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
        VARIANT_STYLES[variant]
      } ${active ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
    >
      <span>{label}</span>
      <span className="text-sm font-bold tabular-nums">
        {count.toLocaleString('ko-KR')}
      </span>
    </Link>
  )
}

function Arrow({ direction = 'right' }: { direction?: 'right' | 'down' }) {
  return (
    <span className="self-center text-gray-400" aria-hidden="true">
      {direction === 'right' ? '→' : '↓'}
    </span>
  )
}

/**
 * 사방넷-style workflow diagram. Each node is clickable and filters the list.
 * Layout: main flow (신규 → 확인 → 출고대기 → 출고완료) on top,
 * claim branches (취소/반품/교환) on bottom, 미발송 on side.
 */
export function WorkflowDiagram({ counts }: WorkflowDiagramProps) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          주문 처리 흐름
        </h2>
        <Link
          href="/orders"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          전체 보기
        </Link>
      </div>

      <div className="space-y-3">
        {/* Main flow: 신규 → 확인 → 출고대기 → 출고완료 */}
        <div className="flex flex-wrap items-center gap-2">
          <Node label="신규" count={counts.new} href="/orders?status=new" variant="primary" />
          <Arrow />
          <Node label="주문확인" count={counts.confirmed} href="/orders?status=confirmed" variant="primary" />
          <Arrow />
          <Node label="출고대기" count={counts.preparing} href="/orders?stage=shipping" variant="warn" />
          <Arrow />
          <Node label="출고완료" count={counts.shipped} href="/orders?status=shipped" variant="success" />
        </div>

        {/* Claim branches + held */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">CS</span>
          <Node label="취소" count={counts.cancelled} href="/orders?claimType=cancel" variant="danger" />
          <Node label="반품" count={counts.returned} href="/orders?claimType=return" variant="warn" />
          <Node label="교환" count={counts.exchanged} href="/orders?claimType=exchange" variant="primary" />
          <span className="mx-2 text-gray-300">|</span>
          <Node label="미발송" count={counts.held} href="/orders?held=true" variant="danger" />
        </div>
      </div>
    </div>
  )
}
