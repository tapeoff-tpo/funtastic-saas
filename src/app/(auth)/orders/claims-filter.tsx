'use client'

import { useQueryState, parseAsString, parseAsBoolean } from 'nuqs'

interface ClaimsFilterProps {
  counts: {
    total: number
    cancel: number
    return: number
    exchange: number
    held: number
  }
}

const CLAIM_TABS: {
  id: string
  label: string
  countKey: keyof ClaimsFilterProps['counts']
  accent?: string
}[] = [
  { id: 'all', label: '전체', countKey: 'total' },
  { id: 'cancel', label: '취소', countKey: 'cancel', accent: 'text-red-600' },
  { id: 'return', label: '반품', countKey: 'return', accent: 'text-orange-600' },
  { id: 'exchange', label: '교환', countKey: 'exchange', accent: 'text-blue-600' },
  { id: 'held', label: '미발송', countKey: 'held', accent: 'text-purple-600' },
]

/**
 * CS-focused tab bar. 취소/반품/교환 set claimType, 미발송 sets held=true.
 * Tabs carry count badges (dim when zero).
 */
export function ClaimsFilter({ counts }: ClaimsFilterProps) {
  const [claimType, setClaimType] = useQueryState('claimType', parseAsString)
  const [held, setHeld] = useQueryState('held', parseAsBoolean)

  // Determine active tab
  const currentTab: string = held
    ? 'held'
    : claimType
    ? claimType
    : 'all'

  async function selectTab(id: string) {
    if (id === 'all') {
      await Promise.all([setClaimType(null), setHeld(null)])
    } else if (id === 'held') {
      await Promise.all([setClaimType(null), setHeld(true)])
    } else {
      await Promise.all([setClaimType(id), setHeld(null)])
    }
  }

  return (
    <div className="flex gap-1 border-b">
      {CLAIM_TABS.map((tab) => {
        const count = counts[tab.countKey]
        const isActive = currentTab === tab.id
        const isEmpty = count === 0
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => void selectTab(tab.id)}
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
