'use client'

import { useQueryState, parseAsString } from 'nuqs'
import type { OrderStage } from '@/lib/orders/types'

const STAGES: { value: OrderStage | 'all'; label: string; hint?: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'mapping', label: '매핑 필요', hint: '상품매핑이 완료되지 않은 주문' },
  { value: 'confirm', label: '확정 대기', hint: '매핑 완료, 주문확인 필요' },
  { value: 'invoice', label: '송장 발급', hint: '주문확인 완료, 송장번호 미등록' },
  { value: 'shipping', label: '출고 대기', hint: '송장 등록됨, 출고 대기중' },
  { value: 'done', label: '완료', hint: '출고/배송 완료' },
]

interface StageTabsProps {
  counts: Record<OrderStage | 'all', number>
}

export function StageTabs({ counts }: StageTabsProps) {
  const [stage, setStage] = useQueryState('stage', parseAsString.withOptions({ shallow: false }))
  const current = stage ?? 'all'

  return (
    <div className="flex flex-wrap gap-1 border-b">
      {STAGES.map((s) => {
        const count = counts[s.value] ?? 0
        const isActive = current === s.value
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => void setStage(s.value === 'all' ? null : s.value)}
            title={s.hint}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
            }`}
          >
            <span>{s.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : count > 0 && (s.value === 'mapping' || s.value === 'confirm' || s.value === 'invoice')
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-muted text-muted-foreground'
            }`}>
              {count.toLocaleString('ko-KR')}
            </span>
          </button>
        )
      })}
    </div>
  )
}
