'use client'

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { deleteMarketplaceConnection } from './actions'
import { Button } from '@/components/ui/button'

interface DeleteConnectionButtonProps {
  marketplaceId: string
}

export function DeleteConnectionButton({
  marketplaceId,
}: DeleteConnectionButtonProps) {
  const [state, formAction, isPending] = useActionState(
    deleteMarketplaceConnection,
    null
  )

  useEffect(() => {
    if (state?.success) {
      toast.success('연결이 해제되었습니다.')
    } else if (state?.error) {
      toast.error(state.error)
    }
  }, [state])

  return (
    <form action={formAction}>
      <input type="hidden" name="marketplace_id" value={marketplaceId} />
      <Button
        type="submit"
        variant="destructive"
        size="sm"
        disabled={isPending}
      >
        {isPending ? '삭제 중...' : '연결 해제'}
      </Button>
    </form>
  )
}
