'use client'

import { useRef, useState, useTransition } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Plus, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  addAiAccountUserCandidateAction,
  createAiAccountAction,
  deleteAiAccountUserCandidatesAction,
} from './actions'

type Props = {
  userCandidates: { id: string; name: string }[]
}

export function AiAccountForm({ userCandidates }: Props) {
  const [accountOpen, setAccountOpen] = useState(false)
  const [usersOpen, setUsersOpen] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const accountFormRef = useRef<HTMLFormElement>(null)

  function createAccount(formData: FormData) {
    setError('')
    startTransition(async () => {
      const result = await createAiAccountAction(null, formData)
      if (result.error) {
        setError(result.error)
        return
      }
      accountFormRef.current?.reset()
      setAccountOpen(false)
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog.Root open={accountOpen} onOpenChange={setAccountOpen}>
        <Dialog.Trigger render={(props) => <Button {...props}><Plus className="h-4 w-4" />계정 추가</Button>} />
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold">공용 계정 추가</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">로그인 정보와 계정별 안내사항을 등록합니다.</Dialog.Description>
            <form ref={accountFormRef} action={createAccount} className="mt-4 space-y-3">
              <label className="block space-y-1"><Label>계정 이름</Label><Input name="name" placeholder="예: 한상철" required /></label>
              <label className="block space-y-1"><Label>아이디</Label><Input name="email" placeholder="메일주소 또는 전화번호" autoComplete="username" /></label>
              <label className="block space-y-1"><Label>비밀번호</Label><Input name="password" type="password" placeholder="계정 비밀번호" autoComplete="new-password" /></label>
              <label className="block space-y-1"><Label>추가 메일</Label><Input name="secondaryEmail" placeholder="복구용 또는 추가 메일" /></label>
              <label className="block space-y-1"><Label>갱신 예정일</Label><Input name="renewalDueOn" type="date" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <Label>초기화 가능</Label>
                  <select name="resetAvailableCount" defaultValue="0" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                    {[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count}개</option>)}
                  </select>
                </label>
                <label className="flex h-9 items-center gap-2 self-end rounded-md border px-3 text-sm">
                  <input type="checkbox" name="sharedUse" className="h-4 w-4" />
                  공유 사용 중
                </label>
              </div>
              <label className="block space-y-1">
                <Label>비고 / 로그인 방법</Label>
                <textarea name="notes" rows={4} placeholder="예: 네이버 간편 로그인, 인증 문자는 담당자에게 요청" className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
              </label>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close render={(props) => <Button {...props} type="button" variant="outline">취소</Button>} />
                <Button type="submit" disabled={isPending}>{isPending ? '저장 중' : '추가'}</Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={usersOpen} onOpenChange={setUsersOpen}>
        <Dialog.Trigger render={(props) => <Button {...props} variant="outline"><Users className="h-4 w-4" />사용자 관리</Button>} />
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-xl">
            <Dialog.Title className="text-base font-semibold">사용자 관리</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">계정을 사용할 직원을 추가하거나 목록에서 제거합니다.</Dialog.Description>
            <form action={addAiAccountUserCandidateAction} className="mt-4 flex gap-2">
              <Input name="name" placeholder="사용자 이름" required />
              <Button type="submit"><Plus className="h-4 w-4" />추가</Button>
            </form>
            <form action={deleteAiAccountUserCandidatesAction} className="mt-4 rounded-md border">
              <div className="max-h-64 divide-y overflow-y-auto">
                {userCandidates.length ? userCandidates.map((candidate) => (
                  <label key={candidate.id} className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted">
                    <input type="checkbox" name="ids" value={candidate.id} className="h-4 w-4" />
                    <span className="truncate">{candidate.name}</span>
                  </label>
                )) : <p className="px-3 py-6 text-center text-sm text-muted-foreground">등록된 사용자가 없습니다.</p>}
              </div>
              {userCandidates.length ? <div className="flex justify-end border-t p-2"><Button type="submit" variant="destructive" size="sm"><Trash2 className="h-4 w-4" />선택 삭제</Button></div> : null}
            </form>
            <div className="mt-4 flex justify-end"><Dialog.Close render={(props) => <Button {...props} type="button" variant="outline">닫기</Button>} /></div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
