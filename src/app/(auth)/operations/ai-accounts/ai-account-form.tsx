'use client'

import { useActionState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createAiAccountAction } from './actions'

export function AiAccountForm() {
  const [state, formAction, isPending] = useActionState(createAiAccountAction, null)

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border bg-background p-3 md:flex-row md:items-end">
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">계정 이름</span>
        <Input name="name" placeholder="예: 홍길동" className="h-9 md:w-40" required />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">계정 아이디</span>
        <Input name="email" placeholder="메일주소 또는 전화번호" className="h-9 md:w-64" />
      </label>
      <Button type="submit" disabled={isPending} className="h-9 md:mb-0">
        <Plus className="h-4 w-4" />
        {isPending ? '추가 중' : '계정 추가'}
      </Button>
      {state?.error ? <p className="text-xs text-destructive md:pb-2">{state.error}</p> : null}
      {state?.success ? <p className="text-xs text-emerald-700 md:pb-2">계정을 추가했습니다.</p> : null}
    </form>
  )
}
