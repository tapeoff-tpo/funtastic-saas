'use client'

/**
 * Phase 8 — 9탭 통합 컴포넌트.
 *
 * 신규 / 확인 / 출고대기 / 출고완료 / 배송중 / 배송완료 / 취소 / 교환 / 반품 / 미발송
 *  → 처음 6개: orders.status (?status=...)
 *  → 취소: ?cancel=1 (cancelTab — status='cancelled' OR claimType='cancel' distinct)
 *  → 교환/반품: ?claimType=exchange|return
 *  → 미발송: ?held=true
 *
 * URL 상태는 직접 router.push 로 갈아끼운다. nuqs 의 shallow:false 만으로는
 * Next.js 16 환경에서 RSC refetch 가 누락되는 케이스가 있어서, useTransition
 * + router.push 조합으로 명확하게 navigation 을 트리거한다.
 */

import { useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

type TabKind = 'all' | 'status' | 'cancel' | 'claim' | 'held'

interface TabDef {
  id: string
  label: string
  kind: TabKind
  accent?: string
}

const TABS: TabDef[] = [
  { id: 'all', label: '전체', kind: 'all' },
  { id: 'new', label: '신규', kind: 'status' },
  { id: 'confirmed', label: '확인', kind: 'status' },
  { id: 'preparing', label: '출고대기', kind: 'status' },
  { id: 'ready', label: '출고준비', kind: 'status' },
  { id: 'shipped', label: '출고완료', kind: 'status' },
  { id: 'delivering', label: '배송중', kind: 'status' },
  { id: 'delivered', label: '배송완료', kind: 'status' },
  { id: 'cancel', label: '취소', kind: 'cancel', accent: 'text-red-600' },
  { id: 'exchange', label: '교환', kind: 'claim', accent: 'text-blue-600' },
  { id: 'return', label: '반품', kind: 'claim', accent: 'text-orange-600' },
  { id: 'held', label: '미발송', kind: 'held', accent: 'text-purple-600' },
]

export function OrderTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  // Determine active tab from URL
  const status = searchParams.get('status')
  const claimType = searchParams.get('claimType')
  const cancel = searchParams.get('cancel')
  const held = searchParams.get('held')
  const tab = searchParams.get('tab')
  const currentTab: string | null = (() => {
    if (held === 'true' || held === '1') return 'held'
    if (cancel === 'true' || cancel === '1') return 'cancel'
    if (claimType === 'exchange') return 'exchange'
    if (claimType === 'return') return 'return'
    if (status) return status
    if (tab === 'all') return 'all'
    return 'all'
  })()

  function buildTabUrl(tab: TabDef): string {
    const params = new URLSearchParams(searchParams.toString())
    // 탭 전환 시 이전 탭 키 + 페이지 번호 초기화
    params.delete('status')
    params.delete('claimType')
    params.delete('cancel')
    params.delete('held')
    params.delete('tab')
    params.delete('page')
    params.delete('mapping')
    params.delete('scan')
    params.delete('scanResult')

    if (tab.kind === 'status') {
      params.set('status', tab.id)
    } else if (tab.kind === 'cancel') {
      params.set('cancel', 'true')
    } else if (tab.kind === 'claim') {
      params.set('claimType', tab.id)
    } else if (tab.kind === 'held') {
      params.set('held', 'true')
    } else if (tab.kind === 'all') {
      // 전체 탭도 명시적으로 ?tab=all 을 붙여서 fetch 트리거
      params.set('tab', 'all')
    }

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
        const isActive = currentTab === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectTab(tab)}
            className={`inline-flex items-center border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? `border-primary ${tab.accent ?? 'text-primary'}`
                : `border-transparent ${tab.accent ?? 'text-muted-foreground'} hover:border-muted-foreground/30 hover:text-foreground`
            } ${isPending && isActive ? 'animate-pulse' : ''}`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
