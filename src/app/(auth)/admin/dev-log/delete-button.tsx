'use client'

import { useTransition } from 'react'
import { deleteDevLogEntry } from './actions'

export function DeleteEntryButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm('이 항목을 삭제하시겠습니까?')) return
        startTransition(() => {
          void deleteDevLogEntry(id)
        })
      }}
      className="text-xs text-muted-foreground hover:text-red-600 disabled:opacity-50"
    >
      {pending ? '삭제 중...' : '삭제'}
    </button>
  )
}
