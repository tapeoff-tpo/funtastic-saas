'use client'

import { useActionState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  addAiAccountUserCandidateAction,
  createAiAccountAction,
  deleteAiAccountUserCandidatesAction,
} from './actions'

type Props = {
  userCandidates: { id: string; name: string }[]
}

export function AiAccountForm({ userCandidates }: Props) {
  const [state, formAction, isPending] = useActionState(createAiAccountAction, null)

  return (
    <section className="grid gap-2 rounded-md border bg-background p-3 xl:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      <form action={formAction} className="flex flex-col gap-2 md:flex-row md:items-end">
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">계정 이름</span>
          <Input name="name" placeholder="예: 홍길동" className="h-9 md:w-40" required />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">계정 아이디</span>
          <Input name="email" placeholder="메일주소 또는 전화번호" className="h-9 md:w-64" />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">추가 메일</span>
          <Input name="secondaryEmail" placeholder="추가 메일" className="h-9 md:w-52" />
        </label>
        <Button type="submit" disabled={isPending} className="h-9 md:mb-0">
          <Plus className="h-4 w-4" />
          {isPending ? '추가 중' : '계정 추가'}
        </Button>
        {state?.error ? <p className="text-xs text-destructive md:pb-2">{state.error}</p> : null}
        {state?.success ? <p className="text-xs text-emerald-700 md:pb-2">계정이 추가되었습니다.</p> : null}
      </form>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
        <form id="add-ai-user-form" action={addAiAccountUserCandidateAction} className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">사용자</span>
          <Input name="name" placeholder="사용자 직접입력" className="h-9" />
        </form>
        <Button type="submit" form="add-ai-user-form" className="h-9">
          <Plus className="h-4 w-4" />
          사용자 추가
        </Button>
        <details className="relative">
          <summary className="flex h-9 cursor-pointer list-none items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
            <Trash2 className="h-4 w-4" />
            사용자 삭제
          </summary>
          <form action={deleteAiAccountUserCandidatesAction} className="absolute right-0 z-20 mt-1 w-72 rounded-md border bg-background p-2 shadow-lg">
            <div className="max-h-56 overflow-y-auto">
              {userCandidates.length ? userCandidates.map((candidate) => (
                <label key={candidate.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" name="ids" value={candidate.id} className="h-4 w-4" />
                  <span className="truncate">{candidate.name}</span>
                </label>
              )) : (
                <p className="px-2 py-3 text-sm text-muted-foreground">등록된 사용자가 없습니다.</p>
              )}
            </div>
            <Button type="submit" variant="destructive" className="mt-2 h-8 w-full">
              선택 사용자 삭제
            </Button>
          </form>
        </details>
      </div>
    </section>
  )
}
