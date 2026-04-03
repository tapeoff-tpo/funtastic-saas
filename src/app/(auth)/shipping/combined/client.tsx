'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { detectCombinedShippingAction } from './actions'

/**
 * Client-side button for detecting new combined shipping candidates.
 */
export function CombinedShippingClient() {
  const [isPending, startTransition] = useTransition()

  const handleDetect = () => {
    startTransition(async () => {
      const result = await detectCombinedShippingAction()
      if (result.created > 0) {
        toast.success(`${result.created}개의 합포장 그룹이 생성되었습니다`)
      } else {
        toast.info('새로운 합포장 대상이 없습니다')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleDetect}
      disabled={isPending}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      {isPending ? '감지중...' : '새로 감지'}
    </button>
  )
}
