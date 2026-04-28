'use client'

/**
 * Phase 8 — 9탭 통합 컴포넌트.
 *
 * 신규 / 확인 / 출고대기 / 출고완료 / 배송중 / 배송완료 / 취소 / 교환 / 반품
 *  → 처음 6개: orders.status (?status=...)
 *  → 취소: ?cancel=1 (cancelTab — status='cancelled' OR claimType='cancel' distinct)
 *  → 교환/반품: ?claimType=exchange|return
 *
 * URL 상태는 nuqs 기반. status / claimType / cancel 은 상호 배타적으로 set한다.
 * (CONTEXT.md D-01 / RESEARCH § Code Example 1)
 */

import { useQueryState, parseAsString, parseAsBoolean } from 'nuqs'

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
  const [status, setStatus] = useQueryState(
    'status',
    parseAsString.withOptions({ shallow: false }),
  )
  const [claimType, setClaimType] = useQueryState(
    'claimType',
    parseAsString.withOptions({ shallow: false }),
  )
  const [cancel, setCancel] = useQueryState(
    'cancel',
    parseAsBoolean.withOptions({ shallow: false }),
  )

  // Determine active tab from URL state
  const currentTab: string = (() => {
    if (cancel) return 'cancel'
    if (claimType === 'exchange') return 'exchange'
    if (claimType === 'return') return 'return'
    if (status) return status
    return 'all'
  })()

  async function selectTab(tab: TabDef) {
    if (tab.id === 'all') {
      await Promise.all([setStatus(null), setClaimType(null), setCancel(null)])
      return
    }
    if (tab.kind === 'status') {
      await Promise.all([setStatus(tab.id), setClaimType(null), setCancel(null)])
      return
    }
    if (tab.kind === 'cancel') {
      await Promise.all([setStatus(null), setClaimType(null), setCancel(true)])
      return
    }
    if (tab.kind === 'claim') {
      await Promise.all([setStatus(null), setClaimType(tab.id), setCancel(null)])
      return
    }
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
            onClick={() => void selectTab(tab)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
            }`}
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
