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
 * 3개 키를 useQueryStates로 묶어 한 번의 batch update로 처리해야 RSC가
 * 한 번만 refetch되고 race condition이 없다. (개별 useQueryState + Promise.all
 * 패턴은 마지막 setter만 살아남아 데이터가 비어 보이는 버그 발생)
 */

import { useRouter } from 'next/navigation'
import { useQueryStates, parseAsString, parseAsBoolean, parseAsInteger } from 'nuqs'

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
  const [tabState, setTabState] = useQueryStates(
    {
      status: parseAsString,
      claimType: parseAsString,
      cancel: parseAsBoolean,
      page: parseAsInteger.withDefault(1),
    },
    { shallow: false },
  )

  // Determine active tab from URL state
  const currentTab: string = (() => {
    if (tabState.cancel) return 'cancel'
    if (tabState.claimType === 'exchange') return 'exchange'
    if (tabState.claimType === 'return') return 'return'
    if (tabState.status) return tabState.status
    return 'all'
  })()

  function applyTabState(next: { status: string | null; claimType: string | null; cancel: boolean | null }) {
    // page=1 로 초기화 (다른 탭으로 갈 때 이전 페이지 번호가 따라가면 빈 결과)
    void setTabState({ ...next, page: 1 }).then(() => router.refresh())
  }

  function selectTab(tab: TabDef) {
    if (tab.id === 'all') {
      applyTabState({ status: null, claimType: null, cancel: null })
      return
    }
    if (tab.kind === 'status') {
      applyTabState({ status: tab.id, claimType: null, cancel: null })
      return
    }
    if (tab.kind === 'cancel') {
      applyTabState({ status: null, claimType: null, cancel: true })
      return
    }
    if (tab.kind === 'claim') {
      applyTabState({ status: null, claimType: tab.id, cancel: null })
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
            onClick={() => selectTab(tab)}
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
