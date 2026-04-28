'use client'

/**
 * Phase 8 — 9탭 통합 컴포넌트.
 *
 * 신규 / 확인 / 출고대기 / 출고완료 / 배송중 / 배송완료 / 취소 / 교환 / 반품
 *  → 처음 6개: orders.status (?status=...)
 *  → 취소: ?cancel=1 (cancelTab — status='cancelled' OR claimType='cancel' distinct)
 *  → 교환/반품: ?claimType=exchange|return
 *
 * URL 상태는 직접 router.push 로 갈아끼운다. nuqs 의 shallow:false 만으로는
 * Next.js 16 환경에서 RSC refetch 가 누락되는 케이스가 있어서, useTransition
 * + router.push 조합으로 명확하게 navigation 을 트리거한다.
 */

import { useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

type TabKind = 'all' | 'status' | 'cancel' | 'claim'

interface TabDef {
  id: string
  label: string
  kind: TabKind
  /** Key into the OrderTabs counts prop */
  countKey:
    | 'all'
    | 'new'
    | 'confirmed'
    | 'preparing'
    | 'ready'
    | 'shipped'
    | 'delivering'
    | 'delivered'
    | 'cancelled'
    | 'exchange'
    | 'return'
  accent?: string
}

const TABS: TabDef[] = [
  { id: 'all', label: '전체', kind: 'all', countKey: 'all' },
  { id: 'new', label: '신규', kind: 'status', countKey: 'new' },
  { id: 'confirmed', label: '확인', kind: 'status', countKey: 'confirmed' },
  { id: 'preparing', label: '출고대기', kind: 'status', countKey: 'preparing' },
  { id: 'ready', label: '출고준비', kind: 'status', countKey: 'ready' },
  { id: 'shipped', label: '출고완료', kind: 'status', countKey: 'shipped' },
  { id: 'delivering', label: '배송중', kind: 'status', countKey: 'delivering' },
  { id: 'delivered', label: '배송완료', kind: 'status', countKey: 'delivered' },
  { id: 'cancel', label: '취소', kind: 'cancel', countKey: 'cancelled', accent: 'text-red-600' },
  { id: 'exchange', label: '교환', kind: 'claim', countKey: 'exchange', accent: 'text-blue-600' },
  { id: 'return', label: '반품', kind: 'claim', countKey: 'return', accent: 'text-orange-600' },
]

export interface OrderTabsCounts {
  all: number
  new: number
  confirmed: number
  preparing: number
  ready: number
  shipped: number
  delivering: number
  delivered: number
  /** 취소 탭 — status='cancelled' OR claimType='cancel' (distinct order) */
  cancelled: number
  exchange: number
  return: number
}

interface OrderTabsProps {
  counts: OrderTabsCounts
}

export function OrderTabs({ counts }: OrderTabsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  // Determine active tab from URL
  const status = searchParams.get('status')
  const claimType = searchParams.get('claimType')
  const cancel = searchParams.get('cancel')
  const currentTab: string = (() => {
    if (cancel === 'true' || cancel === '1') return 'cancel'
    if (claimType === 'exchange') return 'exchange'
    if (claimType === 'return') return 'return'
    if (status) return status
    return 'all'
  })()

  function buildTabUrl(tab: TabDef): string {
    const params = new URLSearchParams(searchParams.toString())
    // 탭 전환 시 이전 탭 키 + 페이지 번호 초기화
    params.delete('status')
    params.delete('claimType')
    params.delete('cancel')
    params.delete('page')

    if (tab.kind === 'status') {
      params.set('status', tab.id)
    } else if (tab.kind === 'cancel') {
      params.set('cancel', 'true')
    } else if (tab.kind === 'claim') {
      params.set('claimType', tab.id)
    }
    // tab.id === 'all' → 아무 키도 set 안 함

    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  function selectTab(tab: TabDef) {
    startTransition(() => {
      router.push(buildTabUrl(tab))
    })
  }

  return (
    <div className="flex flex-wrap gap-1 border-b">
      {TABS.map((tab) => {
        const count = counts[tab.countKey] ?? 0
        const isActive = currentTab === tab.id
        const isEmpty = count === 0
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectTab(tab)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
            } ${isPending && isActive ? 'animate-pulse' : ''}`}
          >
            {tab.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                isEmpty
                  ? 'bg-muted text-muted-foreground/50'
                  : isActive
                    ? 'bg-primary/10 text-primary'
                    : `bg-muted ${tab.accent ?? ''}`
              }`}
            >
              {count.toLocaleString('ko-KR')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
