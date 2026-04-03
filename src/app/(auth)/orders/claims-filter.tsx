'use client'

import { useQueryState, parseAsString } from 'nuqs'
import type { ClaimType } from '@/lib/orders/types'

const CLAIM_TABS: { value: string; label: string }[] = [
  { value: '', label: '전체 주문' },
  { value: 'cancel', label: '취소' },
  { value: 'return', label: '반품' },
  { value: 'exchange', label: '교환' },
]

/**
 * Tab-style filter for claims (D-10).
 * Updates URL param `claimType` via nuqs for server-side filtering.
 */
export function ClaimsFilter() {
  const [claimType, setClaimType] = useQueryState('claimType', parseAsString)

  const currentValue = claimType ?? ''

  return (
    <div className="flex gap-1 border-b">
      {CLAIM_TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => void setClaimType(tab.value || null)}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            currentValue === tab.value
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
